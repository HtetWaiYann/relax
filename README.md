# RELAX

Desktop streaming for movie geeks — search, stream via torrent, and manage a personal library, all in one app.

## Tech stack

- **Electron** + **React 19** + **Vite** + **TypeScript** + **Tailwind v4** — desktop renderer
- **Go** — backend service (torrent engine, metadata, persistence)
- **Protobuf** + **Connect-RPC** — single source of truth for shared types and the RPC contract
- **pnpm workspaces** + **Turborepo** — monorepo orchestration
- **buf** — proto codegen for Go and TypeScript
- **Docker** — dev (macOS, hot-reload) and prod (linux/amd64) backend images
- **GitHub Actions** — lint, test, build, and Docker image pipeline
