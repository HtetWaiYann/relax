# syntax=docker/dockerfile:1.7
#
# Production Dockerfile for the RELAX Go backend.
# Build context: repo root.
#   docker build -f docker/backend.Dockerfile -t relax-backend:latest .
#
# Multi-stage:
#   1. proto  — run `buf generate` against /proto, /buf.* to produce Go bindings
#   2. build  — compile a static linux/amd64 binary (Ubuntu target)
#   3. runtime — distroless static, non-root, just the binary

# ---------- stage 1: proto ----------
FROM bufbuild/buf:1.50.0 AS proto
WORKDIR /src
COPY buf.yaml buf.gen.yaml ./
COPY proto ./proto
RUN buf generate

# ---------- stage 2: build ----------
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
WORKDIR /src

# Module cache: copy go.mod/go.sum first so layers cache cleanly.
COPY apps/backend/go.mod apps/backend/go.sum ./apps/backend/
WORKDIR /src/apps/backend
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download

WORKDIR /src
COPY apps/backend ./apps/backend
COPY --from=proto /src/apps/backend/gen ./apps/backend/gen

ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src/apps/backend
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/relaxd ./cmd/relaxd

# ---------- stage 3: runtime ----------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

LABEL org.opencontainers.image.title="relax-backend" \
      org.opencontainers.image.source="https://github.com/relax/relax" \
      org.opencontainers.image.licenses="MIT"

USER nonroot:nonroot
WORKDIR /app
COPY --from=build /out/relaxd /usr/local/bin/relaxd

ENV PORT=8080 \
    LOG_LEVEL=info \
    APP_ENV=production

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/relaxd"]
