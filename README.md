# Weekly Planner

Weekly dinner planner for two, a sidecar to KitchenOwl. Behaviour: `spec/weekly-planning.allium`. Design and decisions: `ARCHITECTURE.md`. Plan: `ROADMAP.md`.

```
npm install
cp .env.example .env    # fill in KITCHENOWL_URL, KITCHENOWL_TOKEN and SESSION_SECRET
npm run dev             # server on :3000 and the web app on :5173 (open http://localhost:5173/plan/)
npm run test:ci         # typecheck, lint (Biome), tests, unused-code check (knip): what CI and the pre-commit hook run
npm run recipes:check   # reads the recipes from KitchenOwl and checks the data
```

For `http` on localhost set `COOKIE_SECURE=false` in `.env`. Deployment: `DOCKER_DEPLOYMENT.md`.

Node 22 (see `.node-version`).
