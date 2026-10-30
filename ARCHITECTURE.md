# Architecture: Weekly Planner (weekly dinner planner, sidecar to KitchenOwl)

Status: accepted, M0 in progress. Behaviour is defined by `spec/weekly-planning.allium`; this document says how we build it and records why (section 15).

## 1. Goals and constraints

- Two household members agree on dinners for the next 2-3 days, mostly on a phone; KitchenOwl stays the single source of truth for recipes, the planner and the shopping list.
- Backend: Node.js + TypeScript. Frontend: a PWA that looks and feels like KitchenOwl. Separate service next to KitchenOwl (no fork).
- The spec is the source of behaviour. Code is written from it; later the spec is distilled back from the code and compared (the Allium test).
- Small by design: one household, two users, one SQLite file.

## 2. System context

```
 phone (PWA) ──HTTPS──▶ reverse proxy ──▶ planner (Node/TS)  ──▶ SQLite (sessions, votes, meal log)
                              │                 │
                              │                 └──REST──▶ KitchenOwl API (recipes, planner, shopping list)
                              └──────────────▶ KitchenOwl (existing)
```

Ownership:

| Owned by KitchenOwl | Owned by the planner |
|---|---|
| recipes, tags, times, ingredients, photos | planning sessions, plan days, proposals, passes |
| planner entries (one per agreed day) | meal log, cooked recipes |
| shopping list | recipe attribute cache (read-only copy) |

Nothing is written to KitchenOwl while the household is still voting. Finalizing writes the planner entries and the shopping list (section 6).

## 3. Repository layout

```
(repo root = weekly-planner/)
spec/                   weekly-planning.allium (behaviour)
reference/              simulate_spec.py: Python reference model of the spec, test oracle for the ranking
packages/domain/        pure TypeScript: types, rules, invariants, suggestion ranking. No I/O.
apps/server/            Fastify API, persistence, KitchenOwl client, scheduler
apps/web/               React PWA (from M3)
ARCHITECTURE.md  README.md  .env.example
```

The one-off data tools live **outside** this repository, in the parent folder `cooking-mgmt/`: `import/` (Notion and KptnCook importers and their exports) and `foundation/` (the data-foundation scripts and backups of the full recipe database). They contain personal data and are finished jobs, so this repository stays safe to publish; the tag vocabulary they established is encoded in `apps/server/src/kitchenowl/recipeAttributes.ts`.

Tooling: npm workspaces on Node 22, strict TypeScript, Vitest, fast-check (property tests), ESLint, tsx for running TypeScript.

## 4. Domain model (from the spec)

| Spec entity | Table | Notes |
|---|---|---|
| PlanningSession | `sessions` | status open / finalized / closed; `version` for optimistic locking |
| PlanDay | `plan_days` | status open / planned / leftovers; `recipe_id` only when planned |
| Proposal | `proposals` | status pending / accepted / vetoed |
| PassedSuggestion | `passes` | unique (session, recipe) |
| MealLogEntry | `meal_log` | source from_plan / corrected / added; `confirmed` |
| CookedRecipe | `cooked_recipes` | recipe id is the key |
| Recipe (external) | `recipe_cache` | read-only snapshot, see section 5 |
| Member (external) | `members` | the two KitchenOwl users |

Constraints that mirror spec invariants, enforced twice (domain function and database):

- `OneDinnerPerDay`: partial unique index on `plan_days(date)` where status = 'planned'.
- one pending proposal per day: partial unique index on `proposals(day_id)` where status = 'pending'. This is also the "first proposal wins" rule when both members act at once.
- `NoRecipeTwiceInSession`, `NoDessertForDinner`, `WeekdayTimeLimit`: checked in the domain layer on every command and covered by property tests.

Time zone is Europe/Berlin; `is_weekend(date)` is evaluated in it. Dates are stored as plain `YYYY-MM-DD`.

## 5. Recipe attributes (the data foundation)

The planner never reads tags directly in business code. One module, `recipeAttributes.ts`, turns a KitchenOwl recipe into the spec's `Recipe` attributes:

- meal type from `🍽️ Hauptgericht`, `🥦 Beilage`, `🍦 Dessert`, `🍰 Backen`, `🥞 Frühstück`, `🍿 Snack`, `🍸 Getränk`
- base from `🍝 Pasta`, `🍚 Reis`, `🥔 Kartoffeln`, `🌾 Getreide`, `🥖 Brot`, otherwise `other`
- diet from `🌱 Vegan`, `🥬 Vegetarisch`, `🥩 Fleisch`, `🐟 Fisch` (vegan counts as vegetarian)
- proven from `✅ Erprobt` (or a row in `cooked_recipes`), wants-to-try from `⭐ Ausprobieren`
- time from the KitchenOwl `time` field

A recipe missing a meal type or diet is shown in a "needs data" list, never silently dropped. The cache is refreshed when a session starts and on a manual button. The mapping is the same one the simulation (`reference/simulate_spec.py`) already runs against the real data.

## 6. KitchenOwl integration

One client module (`kitchenowl/`), one long-lived service token in the environment (never sent to the browser).

| Purpose | Call |
|---|---|
| read recipes | `GET /api/household/2/recipe` |
| agreed day goes onto the planner | `POST /api/household/2/planner/recipe` `{recipe_id, cooking_date, yields: 2}` |
| fill the shopping list | `POST /api/shoppinglist/{id}/recipeitems` `{items:[{id,name,description,optional}]}` |
| check login | `POST /api/auth` with the member's own username and password |

Finalize is a small saga, recorded in `finalize_steps` (per day: planner entry done / list done) so a failure half-way can be retried without duplicating anything. The session shows "finalized, export pending" until every step is done; a retry job and a manual retry button exist.

### Shopping-list amounts and the same ingredient in several recipes

KitchenOwl keeps one list row per ingredient. When an ingredient is added that is already on the list it merges the descriptions (`app/util/description_merger.py`): the same unit is added up (`200 g` + `300 g` = `500 g`; g, kg, mg and ml, l are normalised; counts add; `EL`, `TL`, `Zehe` etc. add when the unit text is identical), different units stay side by side (`2 EL, 5 g`). So two recipes that need Zwiebel end up as one row with the summed amount. Three things we must handle ourselves, found by reading that code:

1. **Scaling.** KitchenOwl does not scale for us. The planner scales each description to 2 portions (`recipe.yields` → `config.household_size`).
2. **Clean amounts only.** Our descriptions carry notes (`400 g, geschält`). Merged as they are, the note is treated as another unit and becomes garbage such as `600 g, 2 geschält`. The planner therefore sends only the numeric amount and unit (`800 g`) and never the note; the note stays in the recipe.
3. **Consolidate before sending.** The planner sums the amounts per ingredient across all agreed days itself and shows this consolidated list as a preview on the Finalize screen. Then it sends one description per ingredient. Items already on the list (for example one a member added by hand without an amount) are still merged by KitchenOwl, so the result is correct either way. A contract test against the real instance pins this behaviour.

`scaleDescription()` parses a leading number or fraction and unit ("400 g, geschält", "1/2 TL"), multiplies it and leaves anything it cannot parse unchanged and flagged for review. This is the one piece of real parsing in the app and gets its own test table built from the real descriptions. Finalize retries must not add amounts twice, which is why the saga records each exported day.

## 7. Application layer: one command per spec rule

The names match the spec, so conformance can be checked mechanically.

| Spec rule | Command / job |
|---|---|
| StartSession | `startSession(member, dates)` |
| ProposeRecipe / AcceptProposal / VetoProposal / PassSuggestion | same names |
| MarkLeftoverDay, ReopenPlannedDay, ReopenLeftoverDay | `markLeftoverDay`, `reopenDay` |
| SwapPlannedDays, MovePlannedDay | same names (drag and drop) |
| FinalizePlan, CloseSession (two rules) | `finalizePlan`, `closeSession` |
| LogPlannedMeal (temporal) | daily job |
| ConfirmCooked, MarkNotCooked, CorrectLoggedMeal, AddLoggedMeal | same names |
| RemindToFinalize (temporal) | scheduler job → Web Push |

Each command is `(state, input) → events | rejection` in `packages/domain`, so the rules run without a server or database. The server loads state, calls the command, writes the events in one transaction and publishes the change.

`suggestedRecipes(day, context)` is a pure function: hard filters first (main dish, weekday time limit, not planned, not vetoed, not passed), then the ordered soft ranking from the spec guidance (base variety, vegetarian share, one new recipe with wants-to-try first, recent window, stock), with a seeded random tie-break so tests are deterministic. It is a port of the reference model in `reference/simulate_spec.py`, which doubles as its test oracle. Stock is an interface (`StockProvider`) that returns nothing for now; the pantry step plugs in there.

## 8. API and real-time

REST with zod schemas shared by server and web:

- `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/sessions/current`, `POST /api/sessions`, `POST /api/sessions/:id/finalize`, `POST /api/sessions/:id/close`
- `GET /api/sessions/:id/deck?limit=` (next ranked cards for the next open date)
- `POST /api/days/:id/proposals`, `POST /api/proposals/:id/accept`, `POST /api/proposals/:id/veto`, `POST /api/sessions/:id/passes`
- `POST /api/days/swap`, `POST /api/days/move`, `POST /api/days/:id/leftovers`, `POST /api/days/:id/reopen`
- `GET /api/log`, `POST /api/log/:id/confirm`, `POST /api/log/:id/not-cooked`, `PUT /api/log/:id`, `POST /api/log`
- `GET /api/recipes/needs-data`, `POST /api/recipes/refresh`
- `GET /api/sessions/:id/events` (Server-Sent Events): both phones see accepted, vetoed and moved dishes immediately. The client also refetches on reconnect.

Commands return the new session state; stale writes are rejected through `version` and the client simply refetches.

## 9. Frontend (PWA)

React + Vite + TypeScript, TanStack Query for server state, `@dnd-kit` for drag and drop (works with touch), Framer Motion for swiping, `vite-plugin-pwa` for the manifest and service worker. Styling uses CSS custom properties that follow KitchenOwl's Material look (colours, rounded cards, same icon style); the design is recreated, not copied from its code (AGPL).

Screens (German UI):

1. **Plan**: the 2-3 dates as cards, each open, planned or leftovers; drag a dish onto another date to swap or move; Finalize button.
2. **Deck**: one card at a time with photo, time, base, diet, new badge and a hint when the time is missing; swipe right to propose, left to pass; pending proposals appear for the other member to accept or veto.
3. **Log**: the last days with "we cooked it", "we did not", and "something else" (pick a recipe or just a base).
4. **Data**: recipes that need attention (missing time, unclear type).

Offline: the shell and last-seen state are cached so the app opens instantly; actions need the network because the session is shared. The reminder uses Web Push (iOS supports it for installed PWAs); an in-app banner is the fallback.

## 10. Authentication

The login form posts the member's KitchenOwl username and password to our server, which checks them against KitchenOwl and then issues its own httpOnly session cookie. Server-to-KitchenOwl calls use the service token. If you later switch KitchenOwl to OIDC, the login step changes and nothing else does. Only the household's KitchenOwl users can sign in.

## 11. Deployment

One Docker image (multi-stage: build the web app, serve it from Fastify) as an extra service next to KitchenOwl, behind the same reverse proxy and served under `/plan` (configurable base path `BASE_PATH=/plan`). State lives in one SQLite file on a volume, copied nightly. Environment: `KITCHENOWL_URL`, `KITCHENOWL_TOKEN`, `SESSION_SECRET`, `VAPID_*`, `TZ`. No secrets in the repository.

## 12. Spec-driven workflow (the Allium test)

1. Generate tests from the spec (`allium:propagate`) into `packages/domain`: one test per rule precondition and outcome, property tests for the invariants.
2. Implement the domain until those pass; the spec's rule names are the function names.
3. Run the checker (`allium check`) on every spec change; any behaviour decision goes into the spec first, then the code.
4. At the end: distil a spec from the finished code (`allium:distill`) and compare it with the original (`allium:weed`). Differences are the result of the experiment and get written down.

## 13. Milestones

| # | Result | Done when |
|---|---|---|
| M0 | scaffold, KitchenOwl client, recipe attribute mapping, `recipes:check` command | `recipes:check` reports no recipe that needs data on the real instance |
| M1 | domain package + generated tests | all rules and invariants pass, ranking matches the reference model |
| M2 | server, persistence, SSE | two clients see the same session live |
| M3 | PWA: plan, deck, drag and drop | a full plan can be made on a phone |
| M4 | finalize saga: planner entries + scaled shopping list | list and planner correct in KitchenOwl, retry works |
| M5 | meal log, cooked confirmation, reminder | confirming moves a recipe from new to proven |
| M6 | deployment, backup, install on both phones | used for one real week |

## 14. Risks and open points

- KitchenOwl's REST API is not formally versioned; a thin client with contract tests against the real instance limits the blast radius.
- Description scaling (section 6) has to cope with free text; unparseable lines are listed rather than guessed.
- Web Push on iOS needs the app installed to the home screen first.
- Pantry and receipts plug into `StockProvider` later; nothing here depends on them.

## 15. Decision log

| # | Decision | Why | Alternatives rejected |
|---|---|---|---|
| D1 | Separate service next to KitchenOwl (sidecar) | KitchenOwl keeps recipes, planner and shopping list; the app can be built, tested and replaced on its own | Fork: Python/Dart stack we did not choose, rebase on every upstream release, AGPL tie-in. Telegram bot: no drag and drop, chat is a poor shared view |
| D2 | Node.js + TypeScript backend, React PWA | chosen by the household; PWA gives drag and drop and installs on both phones without an app store | Flutter (as KitchenOwl): more work for two users |
| D3 | SQLite in one file | two users, one household, trivial backup | Postgres: operational weight without a need |
| D4 | Sign in with KitchenOwl credentials; server uses one service token | one account for both apps, token never reaches the browser | separate user database |
| D5 | Name **Weekly Planner** (code: `weekly-planner`), served under **/plan** | decided by the household; first called Wochenplaner, renamed because a German name is odd in an English codebase | |
| D6 | Nothing is written to KitchenOwl before Finalize; Finalize writes planner entries and the shopping list | voting stays private to the session; the household decided the shopping list is filled only by an explicit action | write each agreed day immediately |
| D7 | The planner consolidates and scales shopping amounts and sends clean amounts only | KitchenOwl merges same units but does not scale and mangles free-text notes | send descriptions as stored |
| D8 | Behaviour changes go into `spec/weekly-planning.allium` first | spec-first experiment: implement, then distil and compare | |
| D9 | npm workspaces, not pnpm | Node 22 is already installed via nodenv; no extra tool to install | pnpm |
| D10 | Repository root is `weekly-planner/`; spec, architecture and reference model live inside it; `import/` and `foundation/` stay outside | the app can be deployed, shared and checked in CI without personal recipe data; spec and code stay together for the Allium tools | one repo at `cooking-mgmt/` with the data folders ignored: works, but one wrong `git add` would publish the recipe database |
