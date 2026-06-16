# RELAX Backend — A Beginner's Tour (Go)

A walkthrough of `apps/backend` for someone new to Go. We'll cover the folder
layout, then each file, with Go-specific notes inline.

---

## 1. Go in 60 seconds

- **Module**: the unit of dependency. Declared in `go.mod` with a module path
  (here `module relax`) — every import inside the project starts with that path
  (e.g. `relax/internal/server`).
- **Package**: every `.go` file starts with `package <name>`. Files in the same
  folder must share the same package name. The package is the unit of
  encapsulation: identifiers starting with an **uppercase letter are exported**
  (public), lowercase are package-private.
- **`main` package** is special: it produces an executable and must contain
  `func main()`.
- **Imports** are explicit and unused imports are a compile error.
- **No classes**: you have `struct` types and you attach methods to them via a
  receiver: `func (s *RelaxServer) Search(...)`.
- **Interfaces are implicit**: a type satisfies an interface just by having the
  right methods — no `implements` keyword.
- **Errors are values**, not exceptions. The convention is to return
  `(result, error)` and check `if err != nil`.
- **Concurrency**: `go func() { ... }()` launches a goroutine; channels
  (`chan T`) move values between them.

---

## 2. Folder structure

```
apps/backend/
├── cmd/relaxd/main.go         # entrypoint — the program that gets built
├── internal/                  # private code (Go won't let other modules import these)
│   ├── config/                # env-driven configuration
│   ├── server/                # HTTP/Connect-RPC handlers, CORS, validation
│   ├── torrent/               # interface stub for the BitTorrent engine
│   ├── metadata/              # interface stub for the TMDB client
│   └── storage/               # interface stub for persistence (SQLite later)
├── gen/                       # generated proto code (gitignored)
├── go.mod / go.sum            # module + dependency lockfile
├── .env / .env.example        # local config
├── .air.toml                  # hot-reload config for dev (used by docker)
└── .golangci.yml              # linter config
```

Two conventions worth knowing:

- **`cmd/<binary-name>/`** is the idiomatic place for executables. The folder
  name becomes the binary name (`relaxd`). You can have multiple binaries by
  adding more subfolders.
- **`internal/`** is enforced by the Go toolchain: anything under it can only
  be imported by code inside the same module. Great for "this is implementation,
  keep your hands off it" signaling.

---

## 3. `go.mod` — the module file

```go
module relax
go 1.23
require (
    connectrpc.com/connect v1.18.1
    github.com/caarlos0/env/v11 v11.3.1
    github.com/joho/godotenv v1.5.1
    golang.org/x/net v0.34.0
    google.golang.org/protobuf v1.36.4
)
```

- `module relax` — every import in the project starts with `relax/...`.
- `require` lists direct dependencies and exact versions. `go.sum` pins their
  cryptographic hashes.
- Add a dep with `go get <path>@<version>`; tidy unused ones with `go mod tidy`.

---

## 4. `cmd/relaxd/main.go` — the entrypoint

This is where the program starts. Key bits:

```go
func main() {
    if err := run(); err != nil {
        fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
        os.Exit(1)
    }
}
```

The `main()` → `run()` split is a Go idiom: `main` can't return an error, so
delegate to a function that can, then handle exit codes in one place.

What `run()` does:

1. **Loads config** — `config.Load()` parses `.env` + env vars into a struct.
2. **Builds a logger** — `slog` is Go's standard structured logger. JSON in
   production, human-readable text in dev.
3. **Registers handlers** —
   `relaxv1connect.NewRelaxServiceHandler(relaxSrv)` is generated code from
   the `.proto` files. It returns a URL path + an `http.Handler` you mount on
   a `ServeMux` (Go's built-in router).
4. **Wraps with CORS middleware** — `cors(mux)` returns a new handler that
   gates origins before the request reaches `mux`.
5. **Starts the HTTP server in a goroutine** so the main goroutine can wait
   on a shutdown signal:

   ```go
   errCh := make(chan error, 1)            // buffered channel of size 1
   go func() {                              // run server in background
       if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
           errCh <- err
       }
   }()
   ```

6. **Graceful shutdown** via `signal.NotifyContext` — when SIGINT/SIGTERM
   arrives, the context is cancelled and `srv.Shutdown(...)` drains in-flight
   requests for up to 5s.

7. **`h2c.NewHandler(...)`** wraps the handler so it speaks HTTP/2 over
   plaintext (h2c). Connect-Web in the browser needs this to use streaming
   RPCs without TLS in dev.

Go syntax callouts:
- `*http.Server{...}` — `&` would give a pointer to a literal; `*http.Server`
  is the type. Here it's `srv := &http.Server{...}` so `srv` is a pointer.
- `defer stop()` — runs `stop()` when the surrounding function returns. Common
  for cleanup (close files, cancel contexts, unlock mutexes).
- `select { case ... }` — like `switch` but for channels: blocks until one of
  the cases can proceed.

---

## 5. `internal/config/config.go`

```go
type Config struct {
    Port          int    `env:"PORT" envDefault:"8080"`
    TMDBAPIKey    string `env:"TMDB_API_KEY"`
    ...
}
```

- Backticks define **struct tags** — metadata strings the
  `caarlos0/env` library reads via reflection to map env vars to fields.
- `Load()` calls `godotenv.Load()` to read `.env` (if it exists) then
  `env.Parse(&cfg)` to overlay real env vars onto the struct.
- `&cfg` passes a pointer so the library can write into it.
- The receiver methods `IsProduction()` and `SlogLevel()` are attached to
  `Config` itself (not a pointer) because they only read fields.

```go
func (c Config) IsProduction() bool { ... }   // value receiver — c is a copy
func (s *RelaxServer) Search(...)             // pointer receiver — mutates / shares state
```

Rule of thumb: use a pointer receiver if the method mutates the receiver, the
struct is large, or you want all methods on the type to be consistent.

---

## 6. `internal/server/relax_service.go`

This is the actual RPC implementation — currently returning stub data.

```go
type RelaxServer struct {
    logger *slog.Logger
}

var _ relaxv1connect.RelaxServiceHandler = (*RelaxServer)(nil)
```

That second line is a **compile-time interface check**: it assigns a `nil`
pointer to a typed variable named `_` (the blank identifier — "I don't care
about this value"). If `*RelaxServer` doesn't satisfy the interface, the
build fails immediately. It's how Go projects assert "yes, this type
implements that interface" without inheritance.

Each handler follows the Connect-RPC shape:

```go
func (s *RelaxServer) Search(
    _ context.Context,                            // request-scoped cancellation/deadline
    req *connect.Request[relaxv1.SearchRequest],  // generic request wrapper
) (*connect.Response[relaxv1.SearchResponse], error) {
    if err := requireNonEmpty("query", req.Msg.GetQuery()); err != nil {
        return nil, err
    }
    ...
    return connect.NewResponse(&relaxv1.SearchResponse{Results: results, Total: ...}), nil
}
```

- `_ context.Context` — the parameter is unused, so `_` discards the name.
- `[relaxv1.SearchRequest]` — Go generics. `connect.Request` is parameterized
  by the proto message type.
- `req.Msg.GetQuery()` — generated getters that handle nil safely.

`StreamTorrentProgress` is a **server-streaming** RPC: it gets a
`*connect.ServerStream[...]` it can `Send()` updates to repeatedly until it
returns. Note the `select { case <-ctx.Done(): ... case <-time.After(...): }`
pattern — that's idiomatic Go for "wait, but bail out if the client
disconnects."

---

## 7. `internal/server/cors.go`

`NewCORSMiddleware` returns a function that takes an `http.Handler` and
returns a new `http.Handler` — a classic middleware pattern.

```go
func NewCORSMiddleware(allowedOrigin string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            // ... checks, sets headers, then:
            next.ServeHTTP(w, r)
        })
    }
}
```

Three things to notice:

1. **Closures** capture `allowedOrigin` and `next` so the inner function can
   use them later.
2. **`http.HandlerFunc`** is an adapter: it turns a plain function with the
   right signature into something that satisfies the `http.Handler` interface
   (which only requires a `ServeHTTP` method).
3. Preflight (`OPTIONS`) requests get a `204 No Content` early-return — they
   never reach the real handler.

---

## 8. `internal/server/validation.go`

Tiny helpers that return Connect errors with the right status code:

```go
func invalidArg(msg string) error {
    return connect.NewError(connect.CodeInvalidArgument, errors.New(msg))
}
```

Connect's `Code*` constants map to gRPC status codes, which the client
translates to friendly error types. Always return these instead of plain
`errors.New(...)` — they preserve the status across the wire.

---

## 9. The interface-stub packages

`internal/torrent/engine.go`, `internal/metadata/client.go`, and
`internal/storage/store.go` are all the same shape:

```go
package torrent

type Engine interface {
    // TODO: methods will go here
}

type noopEngine struct{}
func New() Engine { return noopEngine{} }
```

Why these exist now:

- They define the **boundary** (the interface) before the implementation,
  so the rest of the app can be coded against it.
- `New()` is the idiomatic Go constructor name. Callers do
  `torrent.New()`, not `torrent.NewEngine()` — package name is already
  context.
- `noopEngine{}` is a zero-value struct used as a placeholder. Once we
  integrate `anacrolix/torrent`, the real implementation slots in behind
  the same `Engine` interface and nothing else has to change.

---

## 10. Tests

Every `_test.go` file lives next to the code it tests, in the same package.
Run with:

```bash
go test ./...                              # everything
go test ./internal/server -run TestSearchReturnsStubResults
```

Test functions are `func TestXxx(t *testing.T)`. They fail the test by
calling methods on `t` (`t.Fatal`, `t.Errorf`).

---

## 11. Mental model summary

- **`cmd/relaxd/main.go`** wires everything together: config → logger →
  RPC handler → CORS middleware → HTTP server with graceful shutdown.
- **`internal/server`** is where requests are handled, validated, and
  CORS-checked.
- **`internal/config`** centralizes all knobs through env vars — no
  hardcoded values anywhere else in the backend.
- **`internal/torrent | metadata | storage`** are interface seams waiting
  for real implementations. The pattern: define the interface first, plug
  in the real thing later, callers never change.

When you add a new RPC: edit the `.proto`, run `pnpm gen:proto`, then
implement the new method on `RelaxServer` and validate inputs through
`validation.go`. That's the whole loop.
