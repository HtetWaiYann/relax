package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"relax/gen/relax/v1/relaxv1connect"
	"relax/internal/config"
	"relax/internal/metadata"
	"relax/internal/server"
	"relax/internal/streams/torrentio"
	"relax/internal/subtitles"
	"relax/internal/subtitles/opensubtitles"
	"relax/internal/subtitles/yifysubs"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	logger := newLogger(cfg)
	slog.SetDefault(logger)

	meta := metadata.New(cfg.TMDBAPIKey)
	streamsProvider := torrentio.New(cfg.TorrentioBaseURL)

	// Subtitle providers: order is irrelevant since the handler aggregates
	// concurrently, but nil entries (e.g. OpenSubtitles without an API key)
	// are filtered out by the server constructor.
	subtitleProviders := []subtitles.Provider{
		yifysubs.New(),
	}
	if cfg.OpenSubtitlesAPIKey != "" {
		subtitleProviders = append(subtitleProviders, opensubtitles.New(cfg.OpenSubtitlesAPIKey))
	}

	relaxSrv := server.NewRelaxServer(logger, meta, streamsProvider, subtitleProviders, cfg.SubtitleCacheDir, cfg.Port)
	path, handler := relaxv1connect.NewRelaxServiceHandler(relaxSrv)

	if err := os.MkdirAll(cfg.SubtitleCacheDir, 0o755); err != nil {
		logger.Warn("could not create subtitle cache dir", "err", err)
	}

	mux := http.NewServeMux()
	mux.Handle(path, handler)
	mux.Handle("/subtitles/", http.StripPrefix("/subtitles/", http.FileServer(http.Dir(cfg.SubtitleCacheDir))))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	cors := server.NewCORSMiddleware(cfg.AllowedOrigin)

	addr := fmt.Sprintf(":%d", cfg.Port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           h2c.NewHandler(cors(mux), &http2.Server{}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	logger.Info("RELAX backend starting", "addr", addr, "env", cfg.AppEnv, "allowed_origin", cfg.AllowedOrigin)
	fmt.Printf("RELAX backend starting on port %s\n", addr)

	errCh := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-errCh:
		return fmt.Errorf("server error: %w", err)
	case <-ctx.Done():
		logger.Info("shutdown signal received")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

func newLogger(cfg config.Config) *slog.Logger {
	opts := &slog.HandlerOptions{Level: cfg.SlogLevel()}
	if cfg.IsProduction() {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, opts))
}
