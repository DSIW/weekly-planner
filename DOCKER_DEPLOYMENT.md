# Docker deployment

The image is built by GitHub Actions when a release is published and pushed to the GitHub Container Registry. The server only pulls and runs it; nothing is compiled there.

## Releases

1. Commits on `main` use the conventional format (`feat:`, `fix:`, `docs:`, `chore:` ...).
2. release-please keeps a release pull request open with the next version and the changelog.
3. Merging that pull request creates the tag and the GitHub release, and the same workflow builds and pushes the image:
   - `ghcr.io/dsiw/weekly-planner:vX.Y.Z`, `:X.Y.Z`, `:X.Y` and `:latest`

If the package is private, run `docker login ghcr.io` once on the server with a token that has `read:packages`.

## First setup on the server

```bash
mkdir -p data && chown 1001:1001 data   # the container runs as uid 1001 and keeps its SQLite file here
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env.production
# edit .env.production: KITCHENOWL_URL, KITCHENOWL_TOKEN, SESSION_SECRET (openssl rand -hex 32)
chmod 600 .env.production
docker compose up -d
docker compose logs -f weekly-planner
```

The container listens on port 3000 and serves the app under `/plan`. Point the reverse proxy that serves KitchenOwl at it **without stripping the prefix**, for example:

```
location /plan/ {
    proxy_pass http://weekly-planner:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Use https: the session cookie is `Secure` by default (`COOKIE_SECURE=false` is only for plain http on localhost). The container and the proxy must share a Docker network, or publish the port for the proxy to reach.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `KITCHENOWL_URL` | yes | base URL of KitchenOwl, no trailing slash needed |
| `KITCHENOWL_TOKEN` | yes | long-lived KitchenOwl token used by the server (never sent to browsers) |
| `KITCHENOWL_HOUSEHOLD_ID` | no (2) | household whose members may sign in |
| `KITCHENOWL_PUBLIC_URL` | no | where phones reach KitchenOwl (URL, or `/` on a shared host): turns on "open in KitchenOwl" links |
| `SHOPPING_LIST_ID` | no (2) | id of the KitchenOwl shopping list that finalizing fills (an id, not a name; on the household's instance 2 is REWE and 3 is Drogerie) |
| `VAPID_SUBJECT` | no (`mailto:planner@example.org`) | who the push services can contact about this server: a `mailto:` address or an https URL. Set a real one: some push services reject the placeholder |
| `SESSION_SECRET` | yes | at least 32 characters; signs the session cookie. Changing it signs everybody out |
| `DATABASE_PATH` | no (`data/planner.sqlite`, `/app/data/planner.sqlite` in the image) | the SQLite file; keep it on a mounted volume or sessions are lost with the container |
| `HOUSEHOLD_TIMEZONE` | no (`Europe/Berlin`) | time zone for "today" and the reminder hour |
| `PORT` | no (3000) | listening port |
| `BASE_PATH` | no (`/plan`) | URL prefix; the web app is built for `/plan/`, so change both together |
| `COOKIE_SECURE` | no (true) | set to `false` only for http on localhost |
| `TRUST_PROXY` | no (true) | read the client address from `X-Forwarded-For` (needed for the login rate limit behind a proxy) |

## Updating

```bash
docker compose pull
docker compose up -d
```

or let Watchtower do it:

```bash
docker run -d --name watchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower --interval 3600 --cleanup weekly-planner
```

## Trying a build locally

```bash
docker build -t weekly-planner .
docker run --rm -p 3000:3000 --env-file .env -e COOKIE_SECURE=false weekly-planner
# http://localhost:3000/plan/
```

## Sign-in

People sign in with their own KitchenOwl account and must be members of the configured household. Each sign-in creates a login session in that person's KitchenOwl account (named `weekly-planner`); they can remove old ones in KitchenOwl.

## Data and backup

Sessions live in one SQLite file (`./data/planner.sqlite`, plus `-wal` and `-shm` files while running). To back it up while the app runs, use SQLite's own copy rather than copying the files:

```bash
docker compose exec weekly-planner node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/app/data/planner.sqlite').exec(\"vacuum into '/app/data/backup.sqlite'\")"
```

Schema changes are applied automatically at start (`pragma user_version` counts the migrations that ran).

## Live updates behind the proxy

The app streams changes to both phones over Server-Sent Events (`/plan/api/events`). The proxy must not buffer or time out that response; Caddy and nginx with `proxy_buffering off` work. The server sends a heartbeat every 25 seconds.
