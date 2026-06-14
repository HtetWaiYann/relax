# Security policy

## Legal use

RELAX implements client-side streaming over the BitTorrent protocol. The project does not endorse, host, or distribute infringing content. **You are solely responsible for ensuring that any torrent you add is legally distributable in your jurisdiction.** RELAX should only be used with public-domain works, Creative Commons content, your own backups, or other material you have the right to stream.

## Defensive defaults

- The Electron renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a strict Content Security Policy applied in the main process.
- Only a narrow, typed surface (`window.relax`) is exposed via `contextBridge` — no Node APIs are reachable from the renderer.
- The Go backend enforces an origin allowlist on every RPC; requests from any origin other than `ALLOWED_ORIGIN` are rejected before reaching a handler.
- All secrets (TMDB API key, DB path, etc.) are loaded from environment variables on the backend only. Nothing sensitive is bundled into the renderer.

## Reporting vulnerabilities

Please open a private GitHub security advisory (preferred) or a regular issue tagged `security` describing the impact, reproduction, and suggested fix. Do not include exploit payloads in public issues.
