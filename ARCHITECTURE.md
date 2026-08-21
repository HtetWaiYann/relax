# RELAX — Building a Desktop Torrent‑Streaming App the Boring Way

*A look at the architecture behind RELAX: a desktop app that streams movies from
torrents, built as an Electron + Go monorepo joined by a single typed contract.*

---

## The one‑liner

RELAX is a desktop streaming app for movie geeks. You search a title, it finds a
torrent, and it streams the video directly to a player — no full download, no
waiting. Under the hood it's two very different runtimes (a Chromium UI and a Go
server) held together by one idea: **the contract is the source of truth.**

---

## The shape of the system

Three moving parts, one rulebook between them.

```
┌─────────────────┐        Connect-RPC         ┌──────────────────┐
│  Electron app   │  ───────(typed)───────────▶ │   Go backend     │
│  (Chromium UI)  │ ◀──────  over H2C  ─────────│   (relaxd)       │
└─────────────────┘                             └──────────────────┘
        ▲                                               │
        │                                               ▼
   window.relax bridge                        torrent · metadata · storage
   (locked-down IPC)                          (TMDB, torrent engine, DB)
```

- **Electron renderer** — the UI. A locked-down Chromium window that never
  touches Node directly.
- **Go backend (`relaxd`)** — does the real work: talks to torrents, fetches
  metadata, streams bytes.
- **The `/proto` contract** — the wire format and the RPC list, defined once and
  generated into both languages.

It's a **pnpm + Turborepo monorepo**, so all of this lives in one repo and builds
with one command.

---

## The big idea: the contract generates both sides

Most bugs at a client/server boundary are shape mismatches — the frontend
expects `position_seconds`, the backend sends `position_ms`, and you find out at
runtime. RELAX makes that impossible by design.

Every request, response, and RPC lives in `.proto` files. A tool called **buf**
reads them and generates:

- **Go types + server interfaces** for the backend
- **TypeScript types + a typed client** for the frontend

Change the contract, run one command, and *both* sides update. If the frontend
uses a field that no longer exists, it fails to compile — not in production, on a
user's machine, at the worst possible moment.

A deliberate choice worth calling out: **the generated code is never committed.**
It's regenerated on every build and in every CI job. The `.proto` files are the
truth; everything else is a build artifact. There's nothing to drift.

The transport is **Connect-RPC over H2C** (HTTP/2 without TLS on localhost), which
lets the browser-based renderer speak to the Go server using a standard web
transport — no exotic networking, no gRPC-in-the-browser gymnastics.

---

## Security by default, not as an afterthought

Streaming from torrents means running untrusted content on a desktop. The
Electron layer is locked down on purpose:

- **Context isolation on, Node integration off, sandbox on.** The UI is treated
  like a web page that can't be trusted with your filesystem.
- **A strict Content-Security-Policy** is injected on every response, so the
  renderer can only load what it's supposed to.
- **A narrow bridge (`window.relax`)** is the *only* way the UI reaches anything
  Node-side. It's a short, explicit list of allowed operations — not a door to
  the whole system.

On the backend:

- **A single-origin CORS allowlist** rejects any request that isn't from the app
  itself — with a 403, *before* it ever reaches a handler.
- **Every input is validated** through shared helpers, so no RPC trusts its
  caller.

The principle throughout: the UI is powerful but caged, and every trust boundary
is enforced in one obvious place.

---

## The backend: interfaces first, real engines behind them

The Go server is organized around three internal capabilities:

- **torrent** — finding and streaming the actual video
- **metadata** — posters, titles, series info (from TMDB)
- **storage** — remembering what you watched and where you left off

Each is an **interface**. Real implementations slot in behind them without the
rest of the app knowing or caring. This keeps the server honest: handlers depend
on *what* a thing does, not *how* it does it, so the torrent engine or the
database can be swapped without a rewrite.

**Config is entirely env-driven** — no hardcoded values anywhere. Every knob,
from the allowed origin to API keys, comes from environment variables with sane
defaults. That's what makes the same binary run identically on a laptop and in a
Docker container.

---

## The build: one graph, no surprises

Turborepo models the whole repo as a **task graph**. The proto-generation step
sits at the root, and `test`, `build`, and `dev` all depend on it. So when a
`.proto` file changes, the code regenerates *automatically* before anything else
runs. You can't accidentally test against a stale contract.

CI mirrors this exactly: **seven parallel jobs** — lint, frontend tests, backend
tests (with the race detector), two build jobs, a Go linter, and a Docker image
build. Every job regenerates the contract from scratch, because there's no
generated code to trust in the repo. The build *is* the verification.

---

## Why build it this way?

A few principles ran through every decision:

1. **One source of truth beats two copies that agree by luck.** The `.proto`
   contract removes an entire category of bugs.
2. **Boundaries should be boring and enforced in one place** — CORS, CSP, the
   IPC bridge, input validation. Security you can point at.
3. **Interfaces over implementations**, so the interesting parts (torrent engine,
   TMDB client, database) can evolve independently.
4. **The build regenerates everything**, so "works on my machine" and "works in
   CI" are the same statement.

None of this is exotic. That's the point. The architecture is deliberately
unremarkable so the *product* — instant, no-wait movie streaming — can be the
interesting part.

---

*RELAX is a personal project: an excuse to build a real cross-runtime desktop app
end to end, and to take architecture, security, and build hygiene as seriously as
the feature itself.*
