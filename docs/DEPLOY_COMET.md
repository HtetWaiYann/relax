# Self-host Comet as the stream source

Torrentio is fronted by Cloudflare and blocks datacenter IPs. ElfHosted's public addons (MediaFusion, Comet) block no-debrid use. The lazy fix that stays free: run **Comet** in the same docker-compose as the backend.

Comet is an open-source Stremio addon that returns raw magnet streams. It pulls torrents from public sources (Zilean — a DMM hash-list mirror) and serves Stremio-shaped JSON, which the existing Torrentio parser in `apps/backend/internal/streams/torrentio/` consumes unchanged. Just point `TORRENTIO_BASE_URL` at the local Comet container.

This guide picks up from [DEPLOY_BACKEND.md](./DEPLOY_BACKEND.md). If you set up WARP via [DEPLOY_WARP.md](./DEPLOY_WARP.md), rip it out — Comet runs on your VPS so there's no CF block to dodge.

---

## 1. Prep the Comet data directory

```bash
sudo mkdir -p /var/lib/comet
```

## 2. Edit `docker-compose.yml`

```bash
nano /opt/relax-backend/docker-compose.yml
```

Replace the file with:

```yaml
services:
  comet:
    image: ghcr.io/g0ldyy/comet:latest
    container_name: relax-comet
    restart: unless-stopped
    volumes:
      - /var/lib/comet:/data
    environment:
      DATABASE_PATH: /data/comet.db
      ZILEAN_URL: https://zilean.elfhosted.com
      INDEXER_MANAGER_TYPE: ""

  backend:
    container_name: relax-backend
    image: htetwaiyan/relax-backend:latest
    depends_on:
      - comet
    ports:
      - "18080:8080"
    env_file:
      - ./.env
    environment:
      APP_ENV: production
    volumes:
      - /var/lib/relax:/data
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
```

Changes vs the WARP setup:
- `warp` service replaced by `comet`.
- Backend `HTTPS_PROXY` env vars removed — no longer proxying.
- Backend `depends_on: [comet]` so Comet boots first.

## 3. Bring the stack up

```bash
cd /opt/relax-backend
docker compose down              # tear down old WARP setup if present
docker compose up -d
docker compose ps                # both 'relax-comet' and 'relax-backend' running
```

Tail Comet's logs once to confirm it booted:

```bash
docker compose logs comet | tail -30
```

Look for `Uvicorn running on http://0.0.0.0:8000`.

## 4. Generate a manifest URL

Comet's manifest URL embeds your config (which sources to use, filters, etc.) in a base64 path segment. Generate it once:

1. Temporarily expose Comet's port to your machine. Add to the `comet` service:
   ```yaml
       ports:
         - "8000:8000"
   ```
   `docker compose up -d comet`.

2. Open `http://<your-vps-ip>:8000/configure` in a browser.

3. Configure:
   - **Debrid Service**: pick **None** (or "Direct Torrent" / "P2P").
   - **Indexers**: enable Zilean. Leave Jackett/Prowlarr off unless you've wired one up.
   - **Filters** (resolution, languages): your preference.
   - Click **Install**.

4. The "Install" button gives a `stremio://<host>:8000/<long-base64>/manifest.json` URL. Copy it. Replace `stremio://` with `http://` and drop `/manifest.json`. You should have something like:
   ```
   http://<your-vps-ip>:8000/eyJ...your-config-base64...
   ```

5. **Remove the `ports:` block from the `comet` service** — backend talks to it over the compose network, no host exposure needed. `docker compose up -d`.

## 5. Point the backend at Comet

```bash
nano /opt/relax-backend/.env
```

Replace whatever was set before with the Comet base URL — **use the compose service name, not the VPS IP**:

```
TORRENTIO_BASE_URL=http://comet:8000/<your-config-base64>
```

(The base64 segment is the same one from step 4, just swap the host for `comet:8000`.)

Restart the backend:

```bash
docker compose restart backend
```

## 6. Sanity check from the server

Hit Comet through the compose network with a throwaway curl container:

```bash
docker run --rm --network relax-backend_default curlimages/curl:latest \
  -sS "http://comet:8000/<your-config-base64>/stream/movie/tt0816692.json" | head -c 500
```

Expect: `{"streams":[{"infoHash":"...","name":"...","title":"...",...}]}`. If you see an empty `streams: []`, Comet hasn't indexed that movie yet — try a popular IMDB id like `tt15398776` (Oppenheimer) and give Zilean a few seconds.

## 7. Re-test from the Electron app

```bash
docker compose logs -f backend | grep -iE 'torrentio'
```

Trigger a search. Expect `torrentio streams ... count=N` with N > 0.

## Updates

```bash
# Server
cd /opt/relax-backend
docker compose pull
docker compose up -d
```

`comet:latest` and `relax-backend:latest` both update from the same `pull`.

## Troubleshooting

- **Comet config page hangs** — Zilean is unreachable. Test from inside Comet: `docker compose exec comet wget -qO- $ZILEAN_URL/healthchecks/ping`. Swap `ZILEAN_URL` to another public mirror if it's down.
- **Empty streams for every movie** — Zilean's hash list doesn't cover the title. Self-host Zilean (Postgres + Zilean container) for fuller coverage, or add Jackett.
- **`infoHash` missing in response** — you picked a debrid service in step 4. Regenerate the manifest with **None** / **P2P** and update `TORRENTIO_BASE_URL`.
- **Comet keeps restarting** — check `docker compose logs comet`. Usually a bad `DATABASE_PATH` permission. `sudo chown -R 1000:1000 /var/lib/comet && docker compose restart comet`.
- **Base URL changes on every config regen** — that's expected. The base64 segment encodes your settings. Pin it in `.env` and only regenerate when you actually change settings.

## Rollback

Comet causes problems? Point at any public Torrentio mirror or back to direct Torrentio (will return empty from a flagged VPS, but valid env):

```bash
nano /opt/relax-backend/.env
# TORRENTIO_BASE_URL=https://torrentio.strem.fun
docker compose stop comet
docker compose rm -f comet
docker compose restart backend
```
