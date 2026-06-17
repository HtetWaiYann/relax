# Bypass Torrentio's Cloudflare WAF with a WARP sidecar

Torrentio is fronted by Cloudflare and blocks most datacenter IPs (DO, Hetzner, AWS, …) — `GetStreams` returns an empty array from the deployed backend even though it works locally.

Fix: run a Cloudflare WARP container next to the backend and route the backend's outbound HTTP through it. Since Torrentio is also on Cloudflare, WARP-routed traffic passes the datacenter block. No code change — Go's default `http.Transport` already honors `HTTPS_PROXY`.

This guide picks up from the end of [DEPLOY_BACKEND.md](./DEPLOY_BACKEND.md). All commands run on the server.

---

## 1. Prep the WARP state directory

WARP needs a persistent dir to remember its registration across container restarts, otherwise it re-registers (and re-rate-limits) every boot.

```bash
sudo mkdir -p /var/lib/relax-warp
```

## 2. Edit `docker-compose.yml`

```bash
nano /opt/relax-backend/docker-compose.yml
```

Replace the file with:

```yaml
services:
  warp:
    image: caomingjun/warp
    container_name: relax-warp
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
    sysctls:
      net.ipv6.conf.all.disable_ipv6: 0
      net.ipv4.conf.all.src_valid_mark: 1
    volumes:
      - /var/lib/relax-warp:/var/lib/cloudflare-warp

  backend:
    container_name: relax-backend
    image: htetwaiyan/relax-backend:latest
    depends_on:
      - warp
    ports:
      - "18080:8080"
    env_file:
      - ./.env
    environment:
      APP_ENV: production
      HTTPS_PROXY: socks5://warp:1080
      HTTP_PROXY: socks5://warp:1080
      NO_PROXY: 127.0.0.1,localhost
    volumes:
      - /var/lib/relax:/data
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
```

What changed:
- New `warp` service.
- `backend` now `depends_on: [warp]` and gets `HTTPS_PROXY=socks5://warp:1080`.
- `NO_PROXY=127.0.0.1,localhost` keeps loopback traffic off the proxy.

## 3. Bring the stack up

```bash
cd /opt/relax-backend
docker compose up -d
docker compose ps     # both 'relax-warp' and 'relax-backend' should be 'running'
```

WARP takes ~5–15 seconds on first boot to register with Cloudflare. Tail its logs once:

```bash
docker compose logs warp | tail -20
```

You're looking for something like `Success` or `Connected`. If you see a registration retry loop, give it another 30 seconds — it's hitting Cloudflare's account API.

## 4. Verify WARP is actually proxying

From inside the WARP container, ask Cloudflare what it thinks of the connection:

```bash
docker compose exec warp curl -s https://www.cloudflare.com/cdn-cgi/trace | grep warp=
```

Expected:

```
warp=on
```

If you see `warp=off` or `warp=plus`, the daemon hasn't finished connecting — wait, then retry.

## 5. Verify the proxy works through WARP

The backend image is **distroless** — no `sh`, no `wget`, no `printenv`. Don't `exec` into it. Verify from the host by running a throwaway curl container on the same Docker network:

```bash
# What's the compose network called?
docker network ls | grep relax-backend
# Usually: relax-backend_default
```

Hit Torrentio *through the WARP container* using that network:

```bash
docker run --rm --network relax-backend_default curlimages/curl:latest \
  -sS -x socks5h://warp:1080 \
  -H 'User-Agent: Mozilla/5.0 (compatible; RELAX/0.1)' \
  https://torrentio.strem.fun/stream/movie/tt0816692.json | head -c 200
```

Expected: a JSON blob starting with `{"streams":[...`.

To confirm the env vars actually landed inside the backend container (since we can't shell in), use `docker inspect`:

```bash
docker inspect relax-backend --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i proxy
```

Should print:
```
HTTPS_PROXY=socks5://warp:1080
HTTP_PROXY=socks5://warp:1080
NO_PROXY=127.0.0.1,localhost
```

If those are missing, the `environment:` block didn't apply — re-check `docker-compose.yml` indentation and run `docker compose up -d` again.

## 6. Re-test from the Electron app

Trigger a real `GetStreams` call. While that runs, tail the backend:

```bash
docker compose logs -f backend | grep -iE 'torrentio|count='
```

You should see `torrentio streams … count=<N>` with N > 0.

## Updates

WARP and the backend now share the same `docker-compose.yml`, so the existing update flow still works:

```bash
# Local
docker buildx build --platform linux/amd64 \
  -f docker/backend.Dockerfile \
  -t htetwaiyan/relax-backend:latest --push .

# Server
ssh you@server 'cd /opt/relax-backend && docker compose pull && docker compose up -d'
```

## Troubleshooting

- **`warp=off` in step 4** — WARP couldn't reach Cloudflare's registration API. Check `docker compose logs warp`. If your host firewall blocks UDP egress, WARP can't connect; open UDP/2408 outbound.
- **Backend still returns empty streams** — confirm step 5 succeeds (curl-through-warp returns JSON) *and* `docker inspect relax-backend` shows the three proxy env vars. If the env vars are missing, the `environment:` block didn't apply — fix compose indentation and `docker compose up -d`. If the env vars are present but streams are still empty, tail `docker compose logs -f backend` while the app fires a request and look for `torrentio non-2xx` or `torrentio http error` — that points at WARP egress failing, not the wiring.
- **TMDB suddenly slow** — every outbound request now hops through WARP. TMDB still works fine from datacenter IPs, so if you want to route *only* Torrentio through WARP, you'd need a per-host proxy in code. Not worth it unless you see real latency hits.
- **`relax-warp` keeps restarting** — kernel is missing the `wireguard` module. On most modern hosts it's built in; on minimal VPS images, `sudo apt install wireguard` and reboot.
- **Need to reset WARP registration** — `sudo rm -rf /var/lib/relax-warp/* && docker compose restart warp`.

## Rollback

If WARP causes more trouble than it solves, remove it without losing the backend:

```bash
nano /opt/relax-backend/docker-compose.yml   # delete the 'warp' service + the HTTPS_PROXY/HTTP_PROXY/NO_PROXY env vars + depends_on
docker compose up -d
docker rm -f relax-warp 2>/dev/null || true
```

Backend goes back to direct egress; Torrentio goes back to returning empty arrays.
