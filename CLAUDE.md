# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RELAX is a desktop torrent-streaming app for movie geeks. The repo is a pnpm + Turborepo monorepo with an Electron renderer (`apps/electron`) and a Go backend (`apps/backend`), joined by a Connect-RPC contract defined in `/proto`.

## Common commands

All commands run from the repo root unless noted.

```bash
pnpm install                        # install JS deps (also installs the buf CLI as a devDep)
pnpm gen:proto                      # regenerate Go + TS from /proto via buf
pnpm dev                            # run backend + Electron app in parallel (Turborepo)
pnpm build                          # full build: gen:proto -> Go binary + electron-vite bundle
pnpm lint                           # ESLint on TS, go vet (+ golangci-lint if installed) on Go
pnpm test                           # vitest (TS) + go test ./... in apps/backend
pnpm format                         # prettier across the repo
```

**Single-test invocations:**

```bash
# Go: run a single package
(cd apps/backend && go test ./internal/server/...)

# Go: run a single test by name
(cd apps/backend && go test ./internal/server -run TestSearchReturnsStubResults)

# Vitest: run a single package's tests
pnpm --filter @relax/shared-utils test

# Vitest: filter by test name
pnpm --filter @relax/shared-utils exec vitest run -t "exposes the app name"
```

**Docker workflows** (backend only — Electron is desktop-native):

```bash
# Dev (Mac), hot-reload via air; renderer still runs natively
pnpm gen:proto && docker compose up backend
# Prod, multi-stage build targeting linux/amd64 (Ubuntu)
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

## Architecture

### The .proto pipeline is the contract

Wire types and RPCs live in `proto/relax/v1/*.proto` (package `relax.v1`). `buf` generates both sides from a single config:

- `buf.gen.yaml` — Go output to `apps/backend/gen/`, TS output to `packages/types/src/gen/`.
- Generated dirs are **gitignored** — never commit them, never hand-edit. After any `.proto` change run `pnpm gen:proto`.
- The TS side uses `@bufbuild/protobuf` v2: service descriptors live in `relax_service_pb.ts` (no separate `_connect.ts` plugin is needed).
- `@relax/types/src/index.ts` re-exports the generated types and exposes `createRelaxClient(transport)` — that's the only entry point the renderer should use.

### Turborepo task graph

`turbo.json` defines a **root-level** task `//#gen:proto` that `test`, `build`, and `dev` all depend on. That means most tasks automatically regenerate proto code first when the inputs (`proto/**/*.proto`, `buf.*`) change. When adding a new pipeline step, mirror that pattern instead of inlining `buf generate` in package scripts.

### Backend (apps/backend)

- Connect-RPC server in `cmd/relaxd/main.go`, served over H2C (`golang.org/x/net/http2/h2c`) so the renderer can use the standard Connect-Web transport.
- `internal/config/config.go` loads everything from env vars via `caarlos0/env` and optionally reads `.env` via `joho/godotenv`. **No hardcoded config** — every new knob goes through this struct.
- `internal/server/relax_service.go` implements the generated `relaxv1connect.RelaxServiceHandler` interface. Today all handlers return placeholders; replace per-method when wiring real implementations.
- `internal/server/cors.go` enforces a single-origin allowlist (`ALLOWED_ORIGIN`) plus the Connect-specific CORS headers. Every cross-origin request that isn't from the allowed origin is rejected with 403 **before** reaching a handler.
- `internal/server/validation.go` has small helpers (`requireNonEmpty`, `requireMagnet`) that return `connect.NewError(connect.CodeInvalidArgument, ...)`. New RPCs should validate inputs through these helpers, not ad-hoc checks.
- `internal/{torrent,metadata,storage}` are **interface stubs** (no real engine, TMDB client, or DB yet). Wire real implementations behind their existing interfaces — don't introduce parallel abstractions.

### Electron app (apps/electron)

- Uses the `electron-vite` layout: `src/main/`, `src/preload/`, `src/renderer/` with three separate Vite configs in `electron.vite.config.ts`.
- BrowserWindow is locked down: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a strict CSP applied in `src/main/index.ts` via `session.webRequest.onHeadersReceived`. Don't loosen these without a clear reason.
- The renderer reaches Node-side info only through `window.relax`, a narrow surface defined in `src/preload/index.ts` and typed by `src/preload/preload.d.ts`. Don't add Node APIs to the renderer; add a method to the bridge instead.
- All backend calls go through the single `relaxClient` exported from `src/renderer/src/lib/client.ts` (a `createRelaxClient(transport)` over `@connectrpc/connect-web`). Don't create ad-hoc fetch calls to the backend.
- Styling is Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js`; `src/renderer/src/index.css` is just `@import "tailwindcss";`).

### Configuration

All backend config is env-driven (see `apps/backend/.env.example` for the full list with defaults). Important: `ALLOWED_ORIGIN` must match the renderer's origin (`http://localhost:5173` in dev) or every RPC will 403.

### Commit conventions

Every commit on this repo **must** follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/). Format:

```
<type>(<scope>): <short summary>

<optional body>

<optional footer(s), e.g. BREAKING CHANGE: ..., Refs: #123>
```

**Allowed types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

**Allowed scopes** (match the repo layout — pick the most specific one):
`backend`, `electron`, `proto`, `types`, `shared-utils`, `docker`, `ci`, `deps`, `repo`.

**Rules:**
- Summary line ≤ 72 characters, lowercase, no trailing period, imperative mood (`add`, not `added`/`adds`).
- Breaking changes go in the footer with `BREAKING CHANGE: <description>` **and** a `!` after the type/scope (`feat(proto)!: rename Search RPC`).
- One logical change per commit. Don't bundle a `feat` with unrelated `chore` cleanup — split them.
- Use `fix(...)` only for actual bug fixes; trivial typo fixes go under `docs` or `chore`.
- Prefer `refactor` over `chore` when behavior is unchanged but code structure moved.
- Generated proto code is gitignored, so commits never include `gen/` diffs. If a commit only touches `.proto`, scope is `proto`.

**Examples:**

```
feat(backend): add StreamTorrentProgress server-streaming handler
fix(electron): prevent CSP from blocking TMDB poster images
docs(repo): document docker-compose dev workflow
refactor(backend): extract origin allowlist into middleware
ci: cache buf-generated code between jobs
build(docker): pin golang base image to 1.25-alpine
feat(proto)!: rename WatchProgress.position_ms to position_seconds
```

### CI

`.github/workflows/ci.yml` has 7 jobs: `lint`, `test-frontend` (vitest), `test-backend` (`go test -race`), `build-frontend` (electron-vite, uploads `out/` artifact), `build-backend` (cross-compiles linux/amd64, uploads binary), `go-lint` (golangci-lint), `docker-backend` (buildx + gha cache, builds the prod image). Each job re-runs `buf generate` because `gen/` isn't committed.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **relax** (238 symbols, 375 relationships, 12 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/relax/context` | Codebase overview, check index freshness |
| `gitnexus://repo/relax/clusters` | All functional areas |
| `gitnexus://repo/relax/processes` | All execution flows |
| `gitnexus://repo/relax/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
