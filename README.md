# Weekly Planner

Weekly dinner planner for two, a sidecar to KitchenOwl. Behaviour: `spec/weekly-planning.allium`. Design and decisions: `ARCHITECTURE.md`. Plan: `ROADMAP.md`.

```
npm install
cp .env.example .env    # fill in KITCHENOWL_URL, KITCHENOWL_TOKEN and SESSION_SECRET
npm run dev             # server on :3000 and the web app on :5173 (open http://localhost:5173/plan/)
npm run test:ci         # typecheck, lint (Biome), tests, unused-code check (knip): what CI and the pre-commit hook run
npm run recipes:check   # reads the recipes from KitchenOwl and checks the data
```

### On a phone

`npm run dev:phone` serves the hot-reloading web app so a phone can open it: every save shows up in seconds, with
no release. It listens on all interfaces (Vite binds to localhost otherwise) and needs a dev address that a reverse proxy
forwards to port 5173 of this machine. `DEV_HOST=dev.example.org` limits it to that address. In Caddy:

```caddy
dev.example.org {
	basic_auth {
		you <hash from `caddy hash-password`>
	}
	reverse_proxy <this-machine>:5173
}
```

Open port 5173 only to the proxy's address (firewall), and set `KITCHENOWL_PUBLIC_URL` in `.env` to the
KitchenOwl the phone should be sent to (its public address; `/` does not work here, the hosts differ).
Open `https://dev.example.org/plan/`.

For `http` on localhost set `COOKIE_SECURE=false` in `.env`. Deployment: `DOCKER_DEPLOYMENT.md`.

Node 22 (see `.node-version`).
