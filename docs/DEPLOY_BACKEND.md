# Deploy the RELAX backend to an existing Docker + nginx host

Assumes:
- Docker is installed on both your laptop and the server, and your user can run `docker` without sudo.
- You have a Docker Hub account (or any registry) and are logged in on both machines (`docker login`).
- nginx is already serving at least one other site on the host.
- DNS for `relax-api.htetwaiyan.com` points at the server.
- You can edit `/etc/nginx/sites-available/` and reload nginx.

Workflow: build the image **locally**, push to **Docker Hub**, pull on the server, run with a tiny compose file. The server never needs the repo.

Replace `htetwaiyan` below with your Docker Hub username.

---

## 1. (Local) Build and push the image

The Dockerfile builds inside Docker, so all you need locally is the repo + buildx.

```bash
cd ~/Documents/ResumeProjects/relax

docker buildx build \
  --platform linux/amd64 \
  -f docker/backend.Dockerfile \
  -t htetwaiyan/relax-backend:latest \
  -t htetwaiyan/relax-backend:$(git rev-parse --short HEAD) \
  --push \
  .
```

`--platform linux/amd64` matters if you're on Apple Silicon — your server is almost certainly amd64. Tag with both `:latest` and the short SHA so you can roll back.

> First time only: `docker buildx create --use` to enable the buildx builder.

## 2. (Server) Deployment directory

The server only needs three things: a `.env`, a `docker-compose.yml`, and a persistent data dir. No git clone.

```bash
ssh you@server
sudo mkdir -p /opt/relax-backend /var/lib/relax
sudo chown $USER:$USER /opt/relax-backend
sudo chown 65532:65532 /var/lib/relax    # distroless 'nonroot' uid
cd /opt/relax-backend
```

## 3. (Server) `.env`

```bash
nano /opt/relax-backend/.env
```

```env
PORT=8080
APP_ENV=production
LOG_LEVEL=info
DATABASE_URL=/data/relax.db

# Renderer origin — the Electron app uses app:// in packaged builds, so allow
# * during early deploys and tighten once you have a stable origin.
ALLOWED_ORIGIN=*

# Required for the metadata/search pipeline
TMDB_API_KEY=<your tmdb key>

# Optional but recommended for subtitles
OPENSUBTITLES_API_KEY=<your opensubs key>
SUBTITLE_CACHE_DIR=/data/subtitle_cache

# Optional override
TORRENTIO_BASE_URL=https://torrentio.strem.fun
```

```bash
chmod 600 /opt/relax-backend/.env
```

## 4. (Server) `docker-compose.yml`

```bash
nano /opt/relax-backend/docker-compose.yml
```

```yaml
services:
  backend:
    container_name: relax-backend
    image: htetwaiyan/relax-backend:latest
    ports:
      # Host port 18080 → container 8080 (8080 is taken on this host).
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

`/var/lib/relax:/data` is what keeps the SQLite DB and subtitle cache across container restarts — the container itself is read-only.

## 5. (Server) Pull and run

```bash
cd /opt/relax-backend
docker compose pull
docker compose up -d
docker compose logs -f backend     # tail logs
```

Verify it's listening:

```bash
curl -s http://127.0.0.1:18080/relax.v1.RelaxService/Search \
  -H 'Content-Type: application/json' \
  -d '{"query":"interstellar"}' | head -c 300
```

You should get a JSON Connect-RPC response (or a clean error if `TMDB_API_KEY` is missing).

## 6. (Server) nginx reverse proxy

Create `/etc/nginx/sites-available/relax-backend.conf`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name relax-api.htetwaiyan.com;

    # Required for Connect-RPC streaming + large payloads
    client_max_body_size 32m;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_request_buffering off;

    # H2C (cleartext HTTP/2) is what the backend speaks internally, but for
    # the public side we let nginx terminate plain HTTP/1.1 — the Connect-Web
    # transport in the renderer works fine over HTTP/1.1.
    location / {
        proxy_pass http://127.0.0.1:18080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Connect-RPC uses a few non-standard headers — pass them through.
        proxy_set_header Connect-Protocol-Version $http_connect_protocol_version;
        proxy_set_header Connect-Timeout-Ms $http_connect_timeout_ms;

        # Long-lived streaming RPCs
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

Enable + reload:

```bash
sudo ln -s /etc/nginx/sites-available/relax-backend.conf /etc/nginx/sites-enabled/
sudo nginx -t          # syntax check
sudo systemctl reload nginx
```

Your other site is untouched — it has its own `server { ... }` block matching a different `server_name`.

## 7. (Server) TLS with certbot (recommended)

```bash
sudo certbot --nginx -d relax-api.htetwaiyan.com
```

Certbot rewrites the vhost in place, adds a `listen 443 ssl` block, and sets up auto-renewal.

After this, point the renderer at `https://relax-api.htetwaiyan.com` (set in the Electron app's `BACKEND_URL` env at build time) and tighten `ALLOWED_ORIGIN` to the renderer's actual origin.

## 8. Updates

On each new release:

```bash
# Local
cd ~/Documents/ResumeProjects/relax
docker buildx build --platform linux/amd64 \
  -f docker/backend.Dockerfile \
  -t htetwaiyan/relax-backend:latest \
  -t htetwaiyan/relax-backend:$(git rev-parse --short HEAD) \
  --push .

# Server
ssh you@server 'cd /opt/relax-backend && docker compose pull && docker compose up -d'
```

The compose file has `restart: unless-stopped`, so the container survives reboots.

## Private images

If you don't want the image public on Docker Hub, mark the repo private and run `docker login` on the server first — `docker compose pull` then authenticates with your saved credentials.

## Troubleshooting

- **`pull access denied`** — image is private and the server isn't logged in. Run `docker login` on the server.
- **`exec format error`** — image was built for arm64 but the server is amd64. Re-build with `--platform linux/amd64`.
- **`403` from every request** — `ALLOWED_ORIGIN` doesn't match the renderer's `Origin` header. Either widen it or fix the renderer's `BACKEND_URL`.
- **`connection refused` from nginx** — container isn't listening; check `docker compose ps` and `docker compose logs backend`.
- **DB resets on container restart** — you forgot the `/var/lib/relax:/data` volume mount, or `DATABASE_URL` still points at the read-only image filesystem.
- **`bind: address already in use`** — something else has `:8080`. Change the host-side port in the compose file (`"18080:8080"`) and update the nginx `proxy_pass`.
