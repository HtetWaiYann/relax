# RELAX

> Desktop streaming for movie geeks — search, stream via torrent, and manage your library, all in one app.

RELAX is a desktop app built with an Electron + React renderer and a Go backend that owns the torrent engine, metadata lookups, and persistence. The two halves share a single source of truth for types and RPCs through Protobuf + Connect-RPC, so every wire-format change is a one-file edit in `/proto`.

```
┌──────────────────────────┐        Connect-RPC        ┌──────────────────────────┐
│  Electron (React + TS)   │  ───────────────────────▶ │  Go backend (relaxd)     │
│  apps/electron           │  ◀───────────────────────  │  apps/backend            │
└──────────────────────────┘     generated types       └──────────────────────────┘
                ▲                                                     ▲
                │            shared .proto definitions                │
                └────────────────────  /proto  ───────────────────────┘
```

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`npm i -g pnpm`)
- **Go** ≥ 1.23
- `buf` CLI is bundled as a devDependency (`@bufbuild/buf`), so you don't need a system install.
- Optional: `golangci-lint` for full Go linting, `air` for Go live-reload.

## Setup

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env
pnpm gen:proto
pnpm dev
```

`pnpm dev` boots both apps in parallel:

- **Backend** (`apps/backend`) on `http://localhost:8080` — logs `RELAX backend starting on port :8080`.
- **Electron app** (`apps/electron`) opens a window titled "RELAX". Click **Search** to call the stub `Search` RPC and render placeholder results — that proves the full typed pipeline (`.proto → Go + TS → Electron UI`) works.

## Layout

```
relax/
├── proto/                # .proto definitions (package relax.v1)
├── apps/
│   ├── electron/         # @relax/electron — Electron main + preload + React renderer
│   └── backend/          # Go module `relax` — Connect-RPC server (cmd/relaxd, internal/*)
├── packages/
│   ├── types/            # @relax/types — generated TS + typed Connect client
│   └── shared-utils/     # @relax/shared-utils — small shared constants
├── buf.yaml, buf.gen.yaml
├── turbo.json, pnpm-workspace.yaml
└── ...
```

## Scripts

| Command            | What it does                                                          |
| ------------------ | --------------------------------------------------------------------- |
| `pnpm dev`         | Run the Go backend and the Electron app together (Turborepo).         |
| `pnpm gen:proto`   | Regenerate Go + TS from `proto/**/*.proto` via `buf`.                 |
| `pnpm build`       | Generate proto, then build the Electron app and the Go binary.        |
| `pnpm lint`        | ESLint for TS packages, `go vet` (+ `golangci-lint` if installed).    |
| `pnpm test`        | Run package-level tests.                                              |
| `pnpm format`      | Run Prettier across the repo.                                         |

## Running with Docker

Electron is a desktop app, so only the Go backend is containerized. The renderer always runs natively on your Mac and talks to the backend over `http://localhost:8080`.

### Dev (macOS)

```bash
pnpm gen:proto                       # writes apps/backend/gen on the host
docker compose up backend            # boots the Go backend with air hot-reload
pnpm --filter @relax/electron dev    # launches the Electron app natively
```

`docker-compose.yml` bind-mounts `apps/backend/` into the container and runs [`air`](https://github.com/air-verse/air), so editing a `.go` file on the host triggers a rebuild + restart inside the container. The Go module + build caches are persisted in Docker named volumes for fast iteration.

### Prod (Ubuntu / linux/amd64)

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

The prod image is a multi-stage build (`docker/backend.Dockerfile`):

1. `bufbuild/buf` generates the Go proto code from `/proto`.
2. `golang:1.23-alpine` cross-compiles a static `linux/amd64` binary.
3. `gcr.io/distroless/static-debian12:nonroot` is the final runtime — no shell, no package manager, runs as non-root.

The compose file sets `read_only: true`, `no-new-privileges`, and tmpfs for `/tmp`. Copy `apps/backend/.env.example` to `apps/backend/.env` and fill in real values before running in prod.

## Editing the proto

`/proto/relax/v1/*.proto` is the single source of truth for shared types and the RPC contract. After editing, regenerate with `pnpm gen:proto` and both sides will see the new types/methods. Generated code is **not** committed.

## Configuration

The Go backend reads everything from env vars (see `apps/backend/.env.example`):

| Var              | Default                  | Notes                                               |
| ---------------- | ------------------------ | --------------------------------------------------- |
| `PORT`           | `8080`                   | HTTP port for the Connect server.                   |
| `TMDB_API_KEY`   | _(empty)_                | Required once the real TMDB client lands.           |
| `DATABASE_URL`   | `./relax.db`             | SQLite path / DSN for the watch-progress store.     |
| `LOG_LEVEL`      | `info`                   | `debug` / `info` / `warn` / `error`.                |
| `ALLOWED_ORIGIN` | `http://localhost:5173`  | Origin allowlist for the Electron renderer.         |
| `APP_ENV`        | `development`            | Set to `production` to enable JSON slog handler.    |

Never commit a real `.env` — see `.gitignore`.

## Security & legal

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, plus a strict CSP set by the main process.
- The backend rejects any cross-origin request that isn't from `ALLOWED_ORIGIN`.
- RELAX streams via the BitTorrent protocol. **Use it only with content you have the legal right to distribute.** See [`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE)
