# syntax=docker/dockerfile:1.7
#
# Development Dockerfile for the RELAX Go backend.
# Used with docker-compose.yml on macOS (Apple Silicon or Intel).
# The host bind-mounts apps/backend into /app and `air` watches for changes.
#
# Build context: repo root.
#   docker build -f docker/backend.dev.Dockerfile -t relax-backend:dev .

FROM golang:1.25-alpine

RUN apk add --no-cache git ca-certificates \
    && go install github.com/air-verse/air@latest

WORKDIR /app

# Warm the module cache so the first `air` cycle is fast.
COPY apps/backend/go.mod apps/backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download

EXPOSE 8080

# Source is bind-mounted from the host via docker-compose.
# Run `pnpm gen:proto` on the host before bringing the container up so
# apps/backend/gen exists on the mount.
CMD ["air", "-c", ".air.toml"]
