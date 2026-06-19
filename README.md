# RELAX

Desktop streaming for movie geeks — search, stream via torrent, and manage a personal library, all in one app.

> **Heads up:** this is a vibe-coded personal project. The codebase is messy in places, conventions drift, and some corners are held together with hope. Read it for ideas, not for style.

## Tech stack

- **Electron** + **React 19** + **Vite** + **TypeScript** + **Tailwind v4** — desktop renderer
- **Go** — backend service (torrent engine, metadata, persistence)
- **Protobuf** + **Connect-RPC** — single source of truth for shared types and the RPC contract
- **pnpm workspaces** + **Turborepo** — monorepo orchestration
- **buf** — proto codegen for Go and TypeScript
- **Docker** — dev (macOS, hot-reload) and prod (linux/amd64) backend images
- **GitHub Actions** — lint, test, build, and Docker image pipeline

## Build it yourself

> Built for personal use. Use at your own risk.

### Prerequisites

- **Node.js 20+** and **pnpm 9+**
- **Go 1.25+**
- **macOS** if you want a `.dmg` installer (Windows can build `.exe` on Windows)

### 1. Configure environment

Copy the example env files and fill in the keys:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/electron/.env.example apps/electron/.env
```

Open `apps/backend/.env` and set:

- `TMDB_API_KEY` — required, get one at <https://www.themoviedb.org/settings/api>
- `OPENSUBTITLES_API_KEY` — optional, subtitles disabled if empty (<https://www.opensubtitles.com/en/consumers>)
- `WYZIE_API_KEY` — optional, alternate subtitle provider (<https://store.wyzie.io/redeem>)

Defaults for `PORT`, `DATABASE_URL`, `ALLOWED_ORIGIN`, etc. work out of the box.

### 2. Install and run in dev

```bash
pnpm install
pnpm dev          # starts backend + Electron renderer
```

### 3. Build a desktop installer for Mac (Apple Silicon Chip)

```bash
pnpm build        # builds backend binary + renderer bundle
```

### 4. Build a desktop installer for all platform

```bash
pnpm build:all
```
