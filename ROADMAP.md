# Roadmap

Status: **agreed** (2026-10-31). It replaces the milestone table that used to be in `ARCHITECTURE.md` section 13; that section now only points here.

## How the work is cut

Every slice is **vertical**: it ships one thing a household member can do on their phone, through the whole stack (PWA, server, SQLite, KitchenOwl where it is involved). A slice is finished only when a person can use it on a real device, not when a layer is complete.

Each slice follows the Allium loop for the behaviour it adds: `tend` the spec first if the behaviour is new, `propagate` tests, implement domain, use case, adapter, API and UI until they pass, then `weed` and `witness` before the slice counts as done. Domain and application code is added to the packages that already exist; nothing is built ahead of the slice that needs it.

Rule of thumb for scope: if a slice cannot be demonstrated on a phone at the end, it is cut wrongly.

## Groundwork (done, not a slice)

| Item | Result |
|---|---|
| M0 | scaffold, KitchenOwl client, recipe attribute mapping, `recipes:check` against the real instance |
| M1 | domain layer and use cases for **all** spec rules, with in-memory fakes; ranking checked against the reference model |

These were cut by layer, not by slice. That was a mistake in the original plan: M1 built every rule before anything could be used, so feedback from a real device comes late. Spec reconciliation for M1 is nearly complete (see "Open items"). The code stays; from here on slices only add adapters, API and UI on top of it and change the domain where a real device shows a problem.

## Slices

### S1a: Walking skeleton

Status: released as v0.1.2 and running on the real server. Verified: sign-in with a real household account, wrong credentials refused, release-please PR, release, image on GHCR, server on the new image. `weed` clean and `witness` PASS (2026-10-31). Still to check by hand: install on one phone, offline shell, and a KitchenOwl user outside the household.

*Both members install the app from the real address, sign in with their KitchenOwl account and see a greeting. Nothing else works yet, but the whole delivery path does.*

- Backend: Fastify server in `apps/server` (section 8), composition root, sign-in with the member's KitchenOwl credentials checked against KitchenOwl and an httpOnly session cookie (section 10), `GET /api/me`, health check.
- Frontend: React + Vite PWA shell under `/plan` (`apps/web`), installable, login form, "Hallo <name>" page.
- Delivery, following the pipelines of the `overtimer` and `nodos` repositories, with a Docker image (section 11, runbook in `DOCKER_DEPLOYMENT.md`):
  - Multi-stage Dockerfile and a compose example for the server, next to KitchenOwl behind the reverse proxy under `/plan`.
  - CI on push and pull request: `npm ci`, typecheck, tests, build.
  - release-please (`release-please-config.json`, manifest, conventional commits, `GITHUB_TOKEN`): it opens a release PR; merging it creates the release and the same workflow builds the image and pushes it to GHCR as `ghcr.io/dsiw/weekly-planner:<version>` and `latest`.
  - Dependabot with grouped updates; minor and patch updates auto-merge once CI is green.
  - Allium spec check workflow (`allium check` fails only on errors, then `allium analyse`).
  - `.npmrc` with `save-exact`, pinned `.node-version`, Biome (lint and format), knip, a husky pre-commit hook running `npm run test:ci`, `CHANGELOG.md` written by release-please.
  - The server updates by pulling the new image (Watchtower or a manual `docker compose pull`); no server credentials live in GitHub.
- Verify by hand: install on one phone from the real address; wrong password is refused; a KitchenOwl user outside the household cannot sign in; the app opens offline to its shell; release-please opens a release PR, publishing it pushes an image to GHCR, and the server runs the new version after a pull.

### S1b: Two phones, one session

*A member picks 2-3 dates and a second client shows the same empty plan, live.*

- Backend: SQLite file and migrations, `SessionRepository`, `StartSession` and read endpoints, Server-Sent Events for session changes.
- Frontend: date picker, plan board with the days, live update via SSE, reconnect refetch.
- Verify by hand: start a session on the phone; a laptop browser signed in as the other member shows it within a second or two; reload keeps it; the server restarts without losing it.

Status: released (v0.1.4) and verified by hand on the real server: both members see the same session live, discarding works, a second start is refused. Decisions made on the way: only **one session is open at a time** (new spec rule on StartSession; a second start is refused, and "Planung verwerfen" abandons the open one so a wrong pick is not stuck), the live stream is household-wide (`GET /api/events`), SQLite is `node:sqlite` (D17, Node 22.22.2).


### S2a: Agree a dinner

*Propose a recipe for the next open day, the other member accepts or vetoes. The list of recipes is plain: eligible dinners only, no ranking yet.*

- Backend: KitchenOwl-backed `RecipeCatalog` with a cache and manual refresh, `DinnerCalendar` on SQLite with the partial unique index, `ProposeRecipe`, `AcceptProposal`, `VetoProposal` over HTTP, SSE events for proposals and decisions. Hard rules only (dinner candidate, weekday limit, not vetoed, not planned).
- Frontend: searchable list of eligible recipes, pending proposal card on the other phone with accept and veto, the next open day fills in date order.
Status: released as v0.1.5, `weed` clean and `witness` PASS; not verified on a phone yet. Decided on the way: a proposal can only be decided while its session is open (closes the "stale proposals" question for what S2a can reach; days marked as leftovers stay a question for S3), the recipe list is remembered for ten minutes and "Rezepte neu laden" skips the wait, and the database refuses a second planned dinner on one date, as a backstop to the DinnerCalendar check.
- Verify by hand: with the real recipe database, agree three days with the phone and a laptop browser as the two members; desserts and long weekday recipes are not offered; a vetoed dish stays out of this session only; two simultaneous proposals leave exactly one pending.

### S2b: The ranked deck

*Swipe through suggestions in the spec's order; pass hides a dish for the session.*

- Backend: `SuggestRecipes` and `PassSuggestion` over HTTP, recent-plan window from earlier sessions, "needs time" flag.
- Frontend: swipe deck (right proposes, left passes) with photo, time, base, diet, new badge and the missing-time hint; replaces the plain list as the default view, the list stays as search.
- Verify by hand: base variety, vegetarian share and one new recipe per session visibly shape the order across a few real sessions; a passed dish disappears for the other member's client too until the next session; a recipe without a cooking time shows the "add time" hint.

### S3: Shape the plan

*Leftover days, reopening, reordering by drag and drop.*

- Backend: `MarkLeftoverDay`, `ReopenDay`, `SwapPlannedDays`, `MovePlannedDay` over HTTP.
- Frontend: leftover marker, reopen, drag and drop between days (swap onto an agreed day, move onto an open day), clear message when the weekday limit forbids a move.
- Decide before wiring `MarkLeftoverDay`, `ReopenDay` and `MovePlannedDay` (open question in the spec, widened by `weed` on S2a): what happens to the pending proposal of a day that is marked as leftovers, moved onto, or vacated; and whether one pending proposal per session becomes an invariant, since a reopened earlier day can become the next open day while a later day still holds a pending proposal.
- Verify by hand: drag a long recipe onto a weekday and see it refused with the reason; drag between weekend days and see it accepted; mark a day as leftovers and reopen it, and reopen an agreed day so the deck offers it again; the second client follows each change.

### S4: Finalize into KitchenOwl

*One button writes the planner entries and a scaled, consolidated shopping list; a reminder nudges when nobody pressed it.*

- Backend: `FinalizePlan` as the saga from `ARCHITECTURE.md` section 6 (per-day export state, retry, no duplicates), amount scaling to two portions, consolidation preview, `PlannerGateway` on KitchenOwl; `RemindToFinalize` scheduler job, Web Push (installed PWA) with in-app banner as fallback.
- Frontend: finalize screen with the consolidated list preview, export status and retry, reminder permission prompt and banner.
- Before wiring the jobs (found by `weed` on S1b): `RemindToFinalize` reads sessions outside the unit of work and saves the stale aggregate inside one, so a command committed in between would be overwritten; re-read inside the unit of work. Also decide what "current session" means once a finalized and an open session coexist (open question in the spec).
- Verify by hand: finalize a real plan and check the planner and the shopping list in KitchenOwl (amounts scaled, items merged); kill the server mid-export and see the retry finish without duplicates; the reminder arrives on the phone at 08:00 on the first agreed day.

### S5: Cook and learn

*The day after, one tap says "we cooked it"; what was really eaten shapes the next suggestions.*

- Backend: `LogPlannedMeals` daily job, `ConfirmCooked`, `MarkNotCooked`, `CorrectLoggedMeal`, `AddLoggedMeal`, experience repository, meal log feeding base variety and the proven flag into the deck.
- Frontend: "yesterday" card with cooked / not cooked / something else, add a meal by base only, history list.
- Verify by hand: confirm a new recipe as cooked and see it count as proven in the next session; mark one as not cooked and see its base stop weighing on the ranking; correct an entry with "something else" (another recipe), and add a meal by its base only.

### S6: One real week

*Nothing new in features; the household uses it for a week, on both phones.*

- Backup and restore of the SQLite file, health check, log rotation, upgrade procedure, error reporting that reaches the household.
- Install and sign in on the second phone; repeat the earlier checklists that need two members on both phones.
- Findings from the week are written down and sorted into fixes and new slices.

### S7: Distil and compare

*The Allium experiment's result.*

- Distil a spec from the finished code (`allium:distill`) and compare it with the original (`allium:weed`).
- Write down the differences and what they say about spec-first versus code-first; update `ARCHITECTURE.md` section 12.
- No feature work; any divergence that turns out to be a real bug becomes a fix before closing.

## Order and dependencies

S1a -> S1b -> S2a -> S2b -> S3 and S2a -> S4 -> S5 -> S6 -> S7 (S2b does not block S3 or S4). S3 can move after S4 if finalizing matters more to the household than rearranging; the order S3 then S4 was confirmed for now. Pantry and receipts come after S6 and plug into the `StockScore` port.

## Open items before S1a

- GitHub setup to do once: the repository setting that lets Actions create pull requests (Settings, Actions, General), and the GHCR package visibility after the first image push. No extra secret is needed (the workflow uses `GITHUB_TOKEN`, as in `nodos`). The `gh` token used in this environment may lack the `workflow` permission needed to push files under `.github/workflows/`; if the push is refused, that permission has to be added.

- Spec: the `LogPlannedMeal` re-fire guard (parked question) is decided in S5 at the latest. Three more questions from the weed report (abandoned sessions, variety across sessions, stale pending proposals) are decided in the slice that touches them: stale proposals were narrowed in S2a (a proposal can only be decided in an open session) and the rest is decided in S3, S2b for variety across sessions, S5 for abandoned sessions.
- Base variety only sees the meal log once S5 exists, so the first real weeks may suggest the same base twice. Decide per slice whether a minimal "add what we ate" arrives earlier (S2b is the natural place); not decided yet.
- The stack is already decided (`ARCHITECTURE.md` sections 8, 9 and 11: Fastify, React + Vite, TanStack Query, `@dnd-kit`, Docker image under `/plan`). S1a only has to prove it end to end.
- The three questions above are now in the spec's open questions section, as `witness` required. Re-run `witness` on M1 to close the groundwork.
- Sign-in sessions last 30 days and are not rechecked against the household: a member removed from KitchenOwl keeps access until the cookie expires. Decide in S6 (recheck on `/api/me`, or a shorter cookie).

## Done means (every slice)

1. Commits follow the conventional format release-please reads (`feat:`, `fix:`, `docs:`, `chore:`). Spec updated if behaviour is new; `allium check` has no findings.
2. Tests pass at all layers: domain, use cases against fakes, adapters by contract tests, HTTP by request tests, UI by component tests, and `npm run smoke`, which drives the built server with the real web client code as two members (it runs in CI). A slice adds its steps to `scripts/smoke.mjs`. Every action in the UI shows a message when it fails (guard tests in `apps/web/test/planning.test.tsx`), and the server logs every failed API call.
3. `weed` clean, `witness` PASS.
4. Deployed to the real instance and verified by hand on one real phone using the slice's checklist. Where a check needs a second member (live updates, accept/veto), a laptop browser signed in as the other member is enough for now; checking on both phones comes with S6.
