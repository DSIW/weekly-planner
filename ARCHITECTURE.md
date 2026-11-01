# Architecture: Weekly Planner (weekly dinner planner, sidecar to KitchenOwl)

Status: accepted. M0 (scaffold) and M1 (domain and use cases) are built; the rest is cut into vertical slices in `ROADMAP.md`. Behaviour is defined by `spec/weekly-planning.allium`; this document says how we build it and records why (section 15). Parts not built yet are marked *planned*.

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

## 3. Architecture style and repository layout

Domain-driven design with an onion (clean) architecture. Source code dependencies point inwards only:

```
              ┌───────────────────────────────────────────────────────────┐
              │ main            composition root, entry points            │
              │  ┌─────────────────────────────────────────────────────┐  │
              │  │ infrastructure   interface                          │  │
              │  │ SQLite, KitchenOwl,   HTTP, SSE, CLI, (web app)     │  │
              │  │ push, clock           translate to/from use cases   │  │
              │  │  ┌───────────────────────────────────────────────┐  │  │
              │  │  │ application   use cases + ports (interfaces)  │  │  │
              │  │  │  ┌─────────────────────────────────────────┐  │  │  │
              │  │  │  │ domain   aggregates, value objects,     │  │  │  │
              │  │  │  │ policies, domain events (no I/O)        │  │  │  │
              │  │  │  └─────────────────────────────────────────┘  │  │  │
              │  │  └───────────────────────────────────────────────┘  │  │
              │  └─────────────────────────────────────────────────────┘  │
              └───────────────────────────────────────────────────────────┘
```

| Layer | Package / folder | May depend on | Contains |
|---|---|---|---|
| domain | `packages/domain` | nothing (no libraries, no `node:`) | aggregates, entities, value objects, policies, domain events |
| application | `packages/application` | domain | use cases, ports (repositories, gateways, clock, notifier) |
| infrastructure | `apps/server/src/infrastructure` | application, domain, libraries | adapters that implement the ports: SQLite repositories, KitchenOwl client and translator, Web Push, scheduler |
| interface | `apps/server/src/interface` | application, domain | HTTP routes, SSE, CLI formatting; no knowledge of adapters |
| main | `apps/server/src/main` | everything | the composition root: reads the environment, builds the adapters, injects them into the use cases |

The rule is enforced by a test (`apps/server/test/architecture/dependency-rule.test.ts`) that reads every import and fails when a layer reaches outwards, so it holds without anyone having to remember it. The check itself is tested against deliberate violations.

```
(repo root = weekly-planner/)
spec/                   weekly-planning.allium (behaviour)
reference/              simulate_spec.py: Python reference model of the spec; generate_ranking_cases.py writes
                        the golden cases that packages/domain/test/planning/ranking-oracle.test.ts replays
packages/domain/        domain layer
packages/application/   application layer
apps/server/            infrastructure, interface and main
apps/web/               React PWA (planned, slice S1a); talks to the server API only
ARCHITECTURE.md  ROADMAP.md  README.md  .env.example
```

The one-off data tools live **outside** this repository, in the parent folder `cooking-mgmt/`: `import/` (Notion and KptnCook importers and their exports) and `foundation/` (the data-foundation scripts and backups of the full recipe database). They contain personal data and are finished jobs, so this repository stays safe to publish; the tag vocabulary they established is encoded in one place, the KitchenOwl translator in the infrastructure layer.

Tooling: npm workspaces on Node 22 (pinned in `.node-version`, exact dependency versions in `.npmrc`), strict TypeScript, Vitest, fast-check (property tests), tsx for running TypeScript, zod for validating KitchenOwl responses. Biome for linting and formatting, knip for unused code, husky runs `npm run test:ci` before every commit. Commits use the conventional format that release-please reads. CI and release workflows are described in section 11.

## 4. Domain model (DDD)

### Bounded contexts

| Context | Kind | Responsibility |
|---|---|---|
| **Meal Planning** | core | sessions, days, proposals, votes, passes, suggestion rules, finalizing |
| **Meal Log** | supporting | what was eaten, confirmation that it was cooked, what is proven |
| **Recipe Catalog** | supporting, external | recipes live in KitchenOwl; the planner sees them through an anti-corruption layer |
| **Shopping Handoff** | supporting | scaling and consolidating amounts, writing the planner entries and the shopping list in KitchenOwl |

The ubiquitous language is the spec's: *session, plan day, proposal, veto, pass, deck, finalize, leftovers, meal log, cooked, proven, new, base, hard rule, soft rule*. Class and method names use these words, and the use-case names equal the spec's rule names.

### Aggregates

| Aggregate (root) | Inside it | Invariants it guards itself |
|---|---|---|
| **PlanningSession** | `PlanDay` entities, `Proposal` entities, `PassedSuggestion` values | lifecycle open → finalized → closed; at most one pending proposal per day; only the next open day receives proposals; proposer cannot decide on their own proposal; hard rules at proposal time (dinner candidate, weekday time limit); a recipe longer than `planAheadMinutes` (6 h) stays eligible on a weekend but is flagged "plan ahead" and ranks last; no recipe twice in the session; no recipe that was vetoed or passed in the session; no change after finalizing; swap and move keep the weekday time limit |
| **MealLogEntry** | one entry | `confirmed` only once; removing an unconfirmed entry; a correction counts as confirmed |
| **RecipeExperience** (key: recipe id) | first-cooked date | exists once per recipe |

Aggregates reference each other by id only. Two rules reach across aggregates and are therefore handled one level up, with a database constraint as the safety net:

- **One dinner per date** spans sessions. The `AcceptProposal` and `MovePlannedDay` use cases ask the `DinnerCalendar` port whether the date is already taken by another session and pass the answer to the domain rule as `dateTakenElsewhere`; a partial unique index rejects a race. (The move case was missing from the first version of the spec; the generated property test did not find it, implementing the use cases did.)
- **Confirming a meal as cooked** also creates the recipe's experience. `MealLogEntry` raises `MealConfirmedAsCooked`; the use case handles it in the same unit of work (one SQLite transaction, a deliberate shortcut over eventual consistency).

### Value objects and domain services

- Value objects: `RecipeId`, `MemberId`, `SessionId`, `ProposalId`, `MealLogEntryId` (branded ids), `PlanDate` (plain calendar date; weekend means Saturday or Sunday), `LocalDateTime` (date and hour, for the reminder), `MealType`, `Base`, `Diet`. *Planned:* `Portions` and `Amount` (number + unit) with slice S4.
- Style: aggregates are immutable data and their rules are pure functions that return `Result<{ state, events }>`: the new state and the events it raised, or the name of the precondition that failed (`reject("not_next_open_day")`). The functions are named after the spec's rules (`proposeRecipe`, `acceptProposal`, ...). There are no classes with hidden state; the application layer does the loading and saving. See D12.
- Policies (pure functions): `isDinnerCandidate` and `fitsWeekdayLimit` for the hard rules; `suggestRecipes` for the soft rules in the spec's order (base variety, vegetarian share, one new recipe with wants-to-try first, recent window) with an injectable random source for the tie-break; `invariantViolations` checks the spec's four invariants over all sessions (used by the property tests). *Planned:* the shopping consolidator for scaling and summing amounts (section 6).
- The ranking is a port of the reference model in `reference/simulate_spec.py`, which doubles as its test oracle: 300 golden cases are replayed against it on every test run. Stock is a port (`StockScore`) that does not exist yet; the pantry step plugs in there.

### Domain events

Aggregate methods return events instead of calling anyone: `SessionStarted`, `RecipeProposed`, `ProposalAccepted`, `ProposalVetoed`, `SuggestionPassed`, `DayMarkedLeftovers`, `DayReopened`, `DaysSwapped`, `DayMoved`, `PlanFinalized` (carries the agreed dinners with date, recipe and portions, instead of one `IngredientsNeeded` per day), `FinalizeReminderDue`, `SessionClosed`, `MealLogged`, `MealConfirmedAsCooked`, `MealMarkedNotCooked`. The application layer publishes them after the commit; infrastructure will turn them into Server-Sent Events, Web Push messages and the KitchenOwl export (planned).

### Persistence mapping (infrastructure, planned)

Nothing is persisted yet; M1 uses in-memory fakes. The mapping below is the target for slice S1b onwards.

| Aggregate part | Table | Notes |
|---|---|---|
| PlanningSession | `sessions` | status open / finalized / closed; `reminder_sent`; `version` for optimistic locking |
| PlanDay | `plan_days` | status open / planned / leftovers; `recipe_id` only when planned |
| Proposal | `proposals` | status pending / accepted / vetoed |
| PassedSuggestion | `passes` | unique (session, recipe) |
| MealLogEntry | `meal_log` | source from_plan / corrected / added; `confirmed`; a removed `from_plan` entry leaves its date in a tombstone so the daily job does not log it again |
| RecipeExperience | `cooked_recipes` | recipe id is the key |
| Member (external) | `members` | the two KitchenOwl users |

Constraints that back up the invariants (the domain enforces them first; the database is the safety net):

- `OneDinnerPerDay`: partial unique index on `plan_days(date)` where status = 'planned'.
- one pending proposal per day: partial unique index on `proposals(day_id)` where status = 'pending'. This is also the "first proposal wins" rule when both members act at once.
- `NoRecipeTwiceInSession`, `NoDessertForDinner`, `WeekdayTimeLimit` are domain checks on every command and are covered by property tests.

Dates are stored as plain `YYYY-MM-DD`. Aggregates are loaded and saved whole by repositories; the domain never sees a table.

## 5. Recipe attributes (the data foundation)

The domain never sees tags. The anti-corruption layer (`infrastructure/kitchenowl/recipe-translator.ts`) turns a KitchenOwl recipe into the domain's `Recipe`, or into a `needs-data` catalogue entry listing the problems:

- meal type from `🍽️ Hauptgericht`, `🥦 Beilage`, `🍦 Dessert`, `🍰 Backen`, `🥞 Frühstück`, `🍿 Snack`, `🍸 Getränk`
- base from `🍝 Pasta`, `🍚 Reis`, `🥔 Kartoffeln`, `🌾 Getreide`, `🥖 Brot`, otherwise `other`
- diet from `🌱 Vegan`, `🥬 Vegetarisch`, `🥩 Fleisch`, `🐟 Fisch` (vegan counts as vegetarian)
- proven from `✅ Erprobt` (or a row in `cooked_recipes`), wants-to-try from `⭐ Ausprobieren`
- time from the KitchenOwl `time` field

A recipe missing a meal type or diet is shown in a "needs data" list, never silently dropped. The cache is refreshed when a session starts and on a manual button. The mapping is the same one the simulation (`reference/simulate_spec.py`) already runs against the real data.

## 6. KitchenOwl integration

One client module (`infrastructure/kitchenowl/`), one long-lived service token in the environment (never sent to the browser).

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

## 7. Application layer: one use case per spec rule

A use case loads aggregates through ports, calls a domain rule, saves, and publishes the returned events after the commit. It contains no business rules (those are in the domain) and no framework or database code. Names match the spec so conformance can be checked mechanically. Rules that need an answer from a port first (the `DinnerCalendar`, the recipe catalogue) ask it before calling the domain; the domain never calls a port.

| Spec rule | Use case | Domain rule (pure function) |
|---|---|---|
| StartSession | `StartSession` | `startSession` |
| ProposeRecipe | `ProposeRecipe` (looks the recipe up in the catalogue) | `proposeRecipe` |
| AcceptProposal | `AcceptProposal` (asks `DinnerCalendar`) | `acceptProposal` |
| VetoProposal, PassSuggestion | `VetoProposal`, `PassSuggestion` | `vetoProposal`, `passSuggestion` |
| MarkLeftoverDay, ReopenPlannedDay, ReopenLeftoverDay | `MarkLeftoverDay`, `ReopenDay` | `markLeftoverDay`, `reopenDay` |
| SwapPlannedDays, MovePlannedDay | same names (drag and drop; the move asks `DinnerCalendar`) | `swapPlannedDays`, `movePlannedDay` |
| FinalizePlan | `FinalizePlan` (the KitchenOwl export is slice S4) | `finalizePlan` |
| AbandonSession, CloseFinalizedSession | `CloseSession` | `closeSession` |
| LogPlannedMeal (temporal) | `LogPlannedMeals` (daily job) | `dinnersDueForLogging`, `logPlannedMeal` |
| ConfirmCooked, MarkNotCooked, CorrectLoggedMeal, AddLoggedMeal | same names; confirming also records the recipe's experience in the same unit of work | `confirmCooked`, `markNotCooked`, `correctLoggedMeal`, `addLoggedMeal`, `registerCooking` |
| RemindToFinalize (temporal) | `RemindToFinalize` (scheduler job; fires once per session) | `remindToFinalize` |
| suggestions (deck) | `SuggestRecipes` (read-only; gathers catalogue, meal log, experience and recent plans) | `suggestRecipes` |
| M0 | `AuditRecipeCatalog` | read-only |

Ports (interfaces owned by the application layer, implemented by adapters): `SessionRepository`, `MealLogRepository`, `RecipeExperienceRepository`, `RecipeCatalog` (`listAll`, `find`), `DinnerCalendar`, `EventPublisher`, `Notifier`, `Clock`, `IdGenerator`, `Randomness`, `UnitOfWork`. *Planned:* `PlannerGateway` (KitchenOwl planner and shopping list, S4) and `StockScore` (pantry, after S6).

How it is tested: the domain by pure unit and property tests, most of them generated from the spec; use cases against in-memory fakes of the ports (`packages/application/test/support/in-memory.ts`); adapters by contract tests (the KitchenOwl client against recorded responses and the real instance, SQLite against a temporary file); the HTTP layer by request tests; the seam between the web client and the server by `scripts/smoke.mjs` (the real client code against the built server and a real SQLite file, as two members; it caught what mocks on either side cannot, see the S1b discard bug); the dependency rule by the architecture test.

## 8. API and real-time

*Planned (slice S1a onwards).* REST with zod schemas shared by server and web:

- `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/sessions/current`, `POST /api/sessions` (409 `session_already_open` while one is open), `POST /api/sessions/:id/finalize`, `POST /api/sessions/:id/close`
- `GET /api/sessions/:id/deck` (ranked cards for the next open date; the deck is not capped, the client pages through it; the order is the same for both members and on every request, because ties are broken by a hash of session and recipe), `GET /api/recipes/:id/photo` (the picture from KitchenOwl, fetched with the service token)
- `GET /api/sessions/:id/recipes` (the plain list for the next open day, by name), `POST /api/sessions/:id/proposals`, `POST /api/sessions/:id/proposals/:proposalId/accept`, `POST /api/sessions/:id/proposals/:proposalId/veto`, `POST /api/sessions/:id/passes`. Proposals live inside the session, so their routes are nested under it.
- `POST /api/days/swap`, `POST /api/days/move`, `POST /api/days/:id/leftovers`, `POST /api/days/:id/reopen`
- `GET /api/log`, `POST /api/log/:id/confirm`, `POST /api/log/:id/not-cooked`, `PUT /api/log/:id`, `POST /api/log`
- `GET /api/recipes/needs-data`, `POST /api/recipes/refresh` (reads KitchenOwl again; the recipe list is otherwise remembered for ten minutes)
- `GET /api/events` (Server-Sent Events): one stream per signed-in phone. Each committed change sends `changed` with the event type, and the client refetches what it shows; it refetches on every (re)connect too, so a missed change heals itself. It is household-wide, not per session, because a phone must learn that a session was started.

Commands return the new session state; stale writes are rejected through `version` and the client simply refetches.

## 9. Frontend (PWA, started in S1a)

React + Vite + TypeScript, TanStack Query for server state, `@dnd-kit` for drag and drop (works with touch), Framer Motion for swiping, The manifest and a small hand-written service worker (`apps/web/public/`) replace `vite-plugin-pwa` (see D15). Styling uses CSS custom properties that follow KitchenOwl's Material look (colours, rounded cards, same icon style); the design is recreated, not copied from its code (AGPL).

Screens (German UI):

1. **Plan**: the 2-3 dates as cards, each open, planned or leftovers; drag a dish onto another date to swap or move; Finalize button.
2. **Deck**: one card at a time with photo, time, base, diet, new badge and a hint when the time is missing; swipe right to propose, left to pass; pending proposals appear for the other member to accept or veto.
3. **Log**: the last days with "we cooked it", "we did not", and "something else" (pick a recipe or just a base).
4. **Data**: recipes that need attention (missing time, unclear type).

Offline: the shell and last-seen state are cached so the app opens instantly; actions need the network because the session is shared. The reminder uses Web Push (iOS supports it for installed PWAs); an in-app banner is the fallback.

## 10. Authentication (built in S1a)

The login form posts the member's KitchenOwl username and password to our server, which checks them against KitchenOwl and then issues its own httpOnly session cookie. Server-to-KitchenOwl calls use the service token. A person must also be a member of the configured KitchenOwl household. The cookie holds only the member's id and name, signed with `SESSION_SECRET`, for 30 days; there are no server-side sessions yet. Each sign-in creates a login session in the person's KitchenOwl account, and login attempts are rate limited per client. If you later switch KitchenOwl to OIDC, the login step changes and nothing else does. Only the household's KitchenOwl users can sign in.

## 11. Deployment (built in S1a, not yet run on the real server)

One Docker image (multi-stage: build the web app, serve it from Fastify) as an extra service next to KitchenOwl, behind the same reverse proxy and served under `/plan` (configurable base path `BASE_PATH=/plan`). State lives in one SQLite file on a volume, copied nightly. Environment: `KITCHENOWL_URL`, `KITCHENOWL_TOKEN`, `SESSION_SECRET`, `VAPID_*`, `TZ`. No secrets in the repository.

Delivery follows the pipelines of the household's `overtimer` and `nodos` repositories (`nodos` publishes a Docker image to GHCR the same way); see `DOCKER_DEPLOYMENT.md` for the runbook:

- CI (GitHub Actions) runs install, typecheck, tests and build on every push and pull request.
- release-please turns conventional commits into a release pull request, a changelog and a version tag. Publishing the release builds the image and pushes it to GHCR as `ghcr.io/dsiw/weekly-planner:<version>` and `latest`.
- Dependabot opens grouped dependency updates; minor and patch updates auto-merge once CI passes.
- A separate workflow runs `allium check` (errors fail the build) and `allium analyse` when the spec changes.
- The server pulls the new image (Watchtower or `docker compose pull`); GitHub holds no credentials for the server.

## 12. Spec-driven workflow (the Allium test)

1. Behaviour first: new or changed behaviour goes into `spec/weekly-planning.allium`, then `allium check` runs on every change.
2. Generate tests from the spec (`allium:propagate`) into `packages/domain`: one test per rule precondition and outcome, property tests for the invariants. They must fail before the code exists.
3. Implement the domain until those pass; the spec's rule names are the function names. Never edit a generated test to make it pass; fix the spec and propagate again.
4. Verify with `allium:weed` (spec and code agree) and `allium:witness` (an independent re-run confirms tests pass, no generated test changed, nothing was parked silently). A slice counts as done only on a clean weed and a witness PASS.
5. At the end: distil a spec from the finished code (`allium:distill`) and compare it with the original (`allium:weed`). Differences are the result of the experiment and get written down.

What M1 taught: writing the code found two gaps the generated tests did not (`MovePlannedDay` across sessions, `AcceptProposal` planning a recipe twice); the reference-model oracle found one ranking divergence; weed found four places where the spec was silent about behaviour the code needed. All are fixed in the spec; one question is parked in it.

## 13. Roadmap

The plan lives in [`ROADMAP.md`](ROADMAP.md). Work is cut into **vertical slices**, each a thing a member can do on a phone through the whole stack (PWA, server, SQLite, KitchenOwl), verified by hand on both phones before the slice is done. M0 (scaffold, KitchenOwl client, `recipes:check`) and M1 (domain and use cases for every spec rule) are the groundwork and are built.

| Slice | Outcome |
|---|---|
| S1a | walking skeleton: install, sign in with KitchenOwl, deployed under `/plan` |
| S1b | two phones, one session, live |
| S2a | agree a dinner: propose, accept, veto from a plain list |
| S2b | the ranked swipe deck with pass |
| S3 | shape the plan: leftovers, reopen, drag and drop |
| S4 | finalize into KitchenOwl: planner entries, scaled shopping list, reminder |
| S5 | cook and learn: meal log, proven recipes |
| S6 | one real week on both phones, backup |
| S7 | distil a spec from the code and compare it with the original |

## 14. Risks and open points

- KitchenOwl's REST API is not formally versioned; a thin client with contract tests against the real instance limits the blast radius.
- Description scaling (section 6) has to cope with free text; unparseable lines are listed rather than guessed.
- Web Push on iOS needs the app installed to the home screen first.
- Pantry and receipts plug into the `StockScore` port later; nothing here depends on them.
- Rules that span aggregates (one dinner per date) depend on the use case asking the `DinnerCalendar`; two requests at the same moment are caught only by the database index, so S2a needs a test for that race.
- Open spec questions (abandoned sessions, variety across sessions, stale pending proposals, re-logging after "not cooked") are assigned to slices in `ROADMAP.md`.

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
| D11 | Domain-driven design with an onion architecture: domain and application are separate packages with no outward dependencies, adapters implement ports, one composition root, the dependency rule is enforced by a test | the behaviour is rule-heavy and will grow (pantry, receipts); the core must be testable without a server, a database or KitchenOwl, and KitchenOwl's tag vocabulary must not leak into it | one `server` package with services calling the KitchenOwl client and SQLite directly: faster to start, but rules and I/O would mix |
| D12 | Aggregates are immutable data with pure rule functions returning `Result<{ state, events }>`, not classes with methods | the spec's rules map one to one onto functions; rejected commands cannot leave half-changed state; property tests can run thousands of random command sequences cheaply | classes with mutable state and exceptions (first sketch of section 7): hidden state, harder to test exhaustively |
| D13 | Work is cut into vertical slices through the whole stack, not by layer | the first plan built every rule before anything could be used on a phone; slices give real feedback early and keep each Allium loop small | milestones by layer (M0 to M6 as first written) |
| D14 | Delivery copies the `overtimer` pipeline (CI, release-please, Dependabot with auto-merge, Allium spec check) and publishes a Docker image to GHCR on release; the server pulls it | one release process for all the household's projects; the app is a long-running service with SQLite, which Vercel cannot host | Vercel (used by `overtimer`, static only); building on the server; deploying over SSH from the workflow (needs server credentials in GitHub) |
| D15 | Hand-written manifest and service worker instead of `vite-plugin-pwa`; Biome instead of ESLint and Prettier; the server is bundled with esbuild into one file | the plugin's current versions pull in Workbox packages with open advisories and do not support Vite 8 in older versions; the shell is tiny; Biome is what `nodos` uses; plain Node cannot run the TypeScript workspace packages | `vite-plugin-pwa` (advisories), ESLint + Prettier (two tools, more config), running with `tsx` in production (slower start, dev dependency in the image) |
| D16 | Node.js stays on an LTS line (even major, currently 22, 24 next); odd majors are never adopted. `.node-version`, the Dockerfile base image and `@types/node` move together, by hand | LTS gets security fixes for years; odd releases are short-lived and a long-running service on SQLite should not chase them | tracking Node's latest release (Dependabot would propose it) |
| D17 | SQLite through Node's built-in `node:sqlite` (Node 22.22.2 and later), sessions stored as a `planning_session` row plus `plan_day` rows with proposals and passes as JSON until a slice needs to query them; a partial unique index allows one open session; one connection, units of work run one after the other | no native module to compile in the Alpine image, one file, the aggregate is loaded and saved whole; the household plans one thing at a time | `better-sqlite3` (native build, prebuilt binaries per platform), a full relational split now (nothing queries proposals before S2a) |
| D18 | A failure of something the server depends on (KitchenOwl, SQLite) is answered 502 `unavailable` by one error handler and logged; Fastify's own client errors (bad JSON, rate limit) keep their 4xx. A dependency's status code is never passed on | a 401 from KitchenOwl once surfaced as a 401 of the planner, which the web app reads as "wrong password" or "not signed in" | passing `status` through (it did, by accident) |
| D19 | A recipe whose total time exceeds `planAheadMinutes` (6 h, from the spec's `plan_ahead_time`) is flagged "Vorlauf nötig" and ranks after every other suggestion, instead of being hidden on weekends | found on the first real use: a 21-hour pizza (dough resting) showed up as an ordinary weekend dinner; the total time in KitchenOwl includes waiting, and the household still wants such dishes available when planned ahead | a weekend time limit (hides the dish), fixing the data only |
| D20 | The deck breaks ties between equally ranked recipes with a hash of session id and recipe id, not a fresh random number; base variety also counts dinners planned in other sessions; until S5 records meals, `NoMealsRecordedYet` stands in for the meal log | a fresh random order reshuffled the cards on every refetch, under a swiping thumb; a dinner planned on Wednesday is not yet logged when Thursday is planned but is a real meal | a seeded generator per request (same effect, harder to test), waiting for the meal log (variety blind to the previous session) |
| D21 | A day never changes under a vote: marking a day as leftovers, reopening a day and moving a dish are refused while a proposal is pending (leftovers: only for the day that holds it), so a session has at most one pending proposal; dragging uses `@dnd-kit` with a handle, a short press on touch screens | withdrawing the proposal would need a fourth proposal status and a silent loss of the other member's suggestion; a refusal costs one tap (decide the vote first) | withdrawing pending proposals on change, dragging the whole row (fights with scrolling on a phone) |
| D22 | A discarded (closed) session no longer holds its dates: the calendar check and the unique index ignore it (`plan_day.blocks_date`, migration 3) | a thrown-away plan blocked accepting dinners on its dates; nothing was cooked or exported | keeping every session's days blocking (spec's old reading), deleting discarded sessions' days (loses history for S5) |
