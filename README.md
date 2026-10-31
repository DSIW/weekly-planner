# Weekly Planner

Weekly dinner planner for two, a sidecar to KitchenOwl. Behaviour: `spec/weekly-planning.allium`. Design and decisions: `ARCHITECTURE.md`. Plan: `ROADMAP.md`.

```
npm install
npm run typecheck
npm test
npm run recipes:check   # reads the recipes from KitchenOwl (needs a `.env`, copy `.env.example`) and checks the data
```

Node 22 (see `.node-version`).
