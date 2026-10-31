# Roadmap

Status: **draft for review**. It replaces the milestone table in `ARCHITECTURE.md` section 13 once agreed.

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

### S1: Two phones, one session

*A member opens the installed app, picks 2-3 dates and both phones show the same empty plan.*

- Backend: Fastify server in `apps/server` (section 8), composition root, SQLite repository for sessions (whole-aggregate load/save), `StartSession` and read endpoints, Server-Sent Events for session changes, identification of the two members (shared household token, member chosen on first start).
- Frontend: React PWA shell served under `/plan`, installable, date picker, plan board with the days, live update via SSE.
- Delivery: the Docker image and reverse-proxy entry from section 11 next to KitchenOwl, so every later slice is tried on the real deployment from day one.
- Verify by hand: start a session on phone A; phone B shows it within a second or two; reload keeps it; "add to home screen" works on both phones.

### S2: Agree a dinner

*One deck, ranked suggestions, propose, accept, veto, pass. The next open day fills in date order.*

- Backend: `SuggestRecipes`, `ProposeRecipe`, `AcceptProposal`, `VetoProposal`, `PassSuggestion` over HTTP; KitchenOwl-backed `RecipeCatalog` with caching; `DinnerCalendar` on SQLite (partial unique index as safety net); SSE events for proposals and decisions.
- Frontend: swipe deck (top suggestion, pass, propose), pending proposal card on the other phone with accept/veto, reminder badge for recipes without a time.
- Verify by hand: with the real recipe database, propose on one phone and accept on the other for three days; weekday limit, no desserts, base variety and "one new recipe" visibly hold; veto and pass hide a dish for the session only.

### S3: Shape the plan

*Leftover days, reopening, reordering by drag and drop.*

- Backend: `MarkLeftoverDay`, `ReopenDay`, `SwapPlannedDays`, `MovePlannedDay` over HTTP.
- Frontend: leftover marker, reopen, drag and drop between days (swap onto an agreed day, move onto an open day), clear message when the weekday limit forbids a move.
- Verify by hand: drag a long recipe onto a weekday and see it refused with the reason; drag between weekend days and see it accepted; both phones follow.

### S4: Finalize into KitchenOwl

*One button writes the planner entries and a scaled, consolidated shopping list; a reminder nudges when nobody pressed it.*

- Backend: `FinalizePlan` as the saga from `ARCHITECTURE.md` section 6 (per-day export state, retry, no duplicates), amount scaling to two portions, consolidation preview, `PlannerGateway` on KitchenOwl; `RemindToFinalize` scheduler job, Web Push (installed PWA) with in-app banner as fallback.
- Frontend: finalize screen with the consolidated list preview, export status and retry, reminder permission prompt and banner.
- Verify by hand: finalize a real plan and check the planner and the shopping list in KitchenOwl (amounts scaled, items merged); kill the server mid-export and see the retry finish without duplicates; the reminder arrives on both phones at 08:00 on the first agreed day.

### S5: Cook and learn

*The day after, one tap says "we cooked it"; what was really eaten shapes the next suggestions.*

- Backend: `LogPlannedMeals` daily job, `ConfirmCooked`, `MarkNotCooked`, `CorrectLoggedMeal`, `AddLoggedMeal`, experience repository, meal log feeding base variety and the proven flag into the deck.
- Frontend: "yesterday" card with cooked / not cooked / something else, add a meal by base only, history list.
- Verify by hand: confirm a new recipe as cooked and see it count as proven in the next session; mark one as not cooked and see its base stop weighing on the ranking.

### S6: One real week

*Nothing new in features; the household uses it for a week.*

- Backup and restore of the SQLite file, health check, log rotation, upgrade procedure, error reporting that reaches the household.
- Findings from the week are written down and sorted into fixes and new slices. Then: distil a spec from the finished code and compare it with the original (`allium:distill`, `allium:weed`); the differences are the result of the Allium experiment.

## Order and dependencies

S1 -> S2 -> S3 and S2 -> S4 -> S5 -> S6. S3 can move after S4 if finalizing matters more to the household than rearranging. Pantry and receipts come after S6 and plug into the `StockScore` port.

## Open items before S1

- Spec: the `LogPlannedMeal` re-fire guard (parked question) is decided in S5 at the latest. Three more questions from the weed report (abandoned sessions, variety across sessions, stale pending proposals) are decided in the slice that touches them: S2 for the proposals and variety, S5 for abandoned sessions.
- The stack is already decided (`ARCHITECTURE.md` sections 8, 9 and 11: Fastify, React + Vite, TanStack Query, `@dnd-kit`, Docker image under `/plan`). S1 only has to prove it end to end.
- Re-run `witness` on M1 after the spec reconciliation to close the groundwork.

## Done means (every slice)

1. Spec updated if behaviour is new; `allium check` has no findings.
2. Tests pass at all layers: domain, use cases against fakes, adapters by contract tests, HTTP by request tests, UI by component and one end-to-end test on two clients.
3. `weed` clean, `witness` PASS.
4. Deployed to the real instance and verified by hand on both phones using the slice's checklist.
