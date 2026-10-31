# Changelog

## [0.1.6](https://github.com/DSIW/weekly-planner/compare/weekly-planner-v0.1.5...weekly-planner-v0.1.6) (2026-10-31)


### Features

* recipes that need a day's lead time are flagged and ranked last ([8b47808](https://github.com/DSIW/weekly-planner/commit/8b478089b49854c14ed1a472656f7c840c6f7cb2))

## [0.1.5](https://github.com/DSIW/weekly-planner/compare/weekly-planner-v0.1.4...weekly-planner-v0.1.5) (2026-10-31)


### Features

* agree a dinner, one member proposes and the other accepts or vetoes (S2a) ([1199f35](https://github.com/DSIW/weekly-planner/commit/1199f35c391a5af6a5dd7178d882ceec1ee7da9f))

## [0.1.4](https://github.com/DSIW/weekly-planner/compare/weekly-planner-v0.1.3...weekly-planner-v0.1.4) (2026-10-31)


### Bug Fixes

* discarding a planning did nothing because the request had a JSON content type and no body ([aacb5ff](https://github.com/DSIW/weekly-planner/commit/aacb5ff8353b03bf613232b9e37d04b972d84bab))

## [0.1.3](https://github.com/DSIW/weekly-planner/compare/weekly-planner-v0.1.2...weekly-planner-v0.1.3) (2026-10-31)


### Features

* shared planning session on two phones, live over SSE, persisted in SQLite (S1b) ([ea9c9bf](https://github.com/DSIW/weekly-planner/commit/ea9c9bf87d3e0b003e718660b1acfc9585cc6e19))


### Bug Fixes

* a concurrent second start answers session_already_open instead of failing with 500 ([44b332b](https://github.com/DSIW/weekly-planner/commit/44b332b87d0959c85fe7e0aef4dab2283ff83d20))

## [0.1.2](https://github.com/DSIW/weekly-planner/compare/weekly-planner-v0.1.1...weekly-planner-v0.1.2) (2026-10-31)


### Bug Fixes

* log what KitchenOwl answered when it rejects a sign-in ([561b6a1](https://github.com/DSIW/weekly-planner/commit/561b6a1543bd8415f08915695f25c7b3d67c33d0))
* report a failing KitchenOwl lookup as unavailable, not as a wrong password ([18c352c](https://github.com/DSIW/weekly-planner/commit/18c352c2197890da62e24d3c9706637dc976d7ea))

## [0.1.1](https://github.com/DSIW/weekly-planner/compare/weekly-planner-v0.1.0...weekly-planner-v0.1.1) (2026-10-31)


### Bug Fixes

* add the missing .npmrc the Dockerfile copies ([43afc18](https://github.com/DSIW/weekly-planner/commit/43afc182ef6af0b71b09917ade364edeb6969340))

## 0.1.0 (2026-10-31)


### Features

* walking skeleton with KitchenOwl sign-in, PWA shell and Docker delivery (S1a) ([ecc4090](https://github.com/DSIW/weekly-planner/commit/ecc409064f5abea8336ea5e35f1cfab8bda96323))


### Miscellaneous Chores

* release 0.1.0 ([4c658bf](https://github.com/DSIW/weekly-planner/commit/4c658bf4ce4c90eb8a6f57d5e17288cb5c22d1e0))
