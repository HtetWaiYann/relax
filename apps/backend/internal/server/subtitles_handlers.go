package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/sync/errgroup"

	relaxv1 "relax/gen/relax/v1"
	"relax/internal/subtitles"
)

// perProviderTimeout caps each provider's search so one slow source can't
// hold up the whole response. Individual failures are logged and skipped.
const perProviderTimeout = 8 * time.Second

func (s *RelaxServer) SearchSubtitles(
	ctx context.Context,
	req *connect.Request[relaxv1.SearchSubtitlesRequest],
) (*connect.Response[relaxv1.SearchSubtitlesResponse], error) {
	tmdbID := req.Msg.GetTmdbId()
	if tmdbID <= 0 {
		return nil, invalidArg("tmdb_id must be positive")
	}
	if len(s.subtitles) == 0 {
		return connect.NewResponse(&relaxv1.SearchSubtitlesResponse{}), nil
	}

	mt := req.Msg.GetMediaType()
	imdbID, err := s.meta.IMDBID(ctx, mt, tmdbID)
	if err != nil || imdbID == "" {
		s.logger.Warn("SearchSubtitles: IMDBID resolution failed", "err", err, "tmdb_id", tmdbID)
		return connect.NewResponse(&relaxv1.SearchSubtitlesResponse{}), nil
	}

	season, episode := req.Msg.GetSeason(), req.Msg.GetEpisode()

	var (
		mu        sync.Mutex
		merged    []*relaxv1.SubtitleTrack
		successes int
	)
	g, gctx := errgroup.WithContext(ctx)
	for _, p := range s.subtitles {
		p := p
		g.Go(func() error {
			pctx, cancel := context.WithTimeout(gctx, perProviderTimeout)
			defer cancel()
			tracks, err := p.Search(pctx, imdbID, season, episode)
			if err != nil {
				s.logger.Warn("subtitle provider search failed", "provider", p.Name(), "err", err)
				return nil // never propagate — partial results are still useful
			}
			mu.Lock()
			merged = append(merged, tracks...)
			successes++
			mu.Unlock()
			return nil
		})
	}
	_ = g.Wait() // we swallow individual errors above; errgroup will only error if ctx is cancelled

	// Only surface an error if every provider failed AND we had nothing to return.
	// Otherwise the renderer sees the union of whatever came back.
	if successes == 0 && len(merged) == 0 {
		s.logger.Warn("all subtitle providers failed", "providers", len(s.subtitles))
	}
	return connect.NewResponse(&relaxv1.SearchSubtitlesResponse{Tracks: merged}), nil
}

func (s *RelaxServer) DownloadSubtitle(
	ctx context.Context,
	req *connect.Request[relaxv1.DownloadSubtitleRequest],
) (*connect.Response[relaxv1.DownloadSubtitleResponse], error) {
	ref := req.Msg.GetTrackReference()
	if ref == "" {
		return nil, invalidArg("track_reference is required")
	}
	name, providerRef, ok := subtitles.SplitRef(ref)
	if !ok {
		return nil, invalidArg("track_reference must be {provider}:{id}")
	}
	provider, ok := s.subtitles[name]
	if !ok {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("subtitle provider %q not configured", name))
	}

	cacheKey := subtitles.CacheKey(ref)
	cached := filepath.Join(s.subtitleCache, cacheKey+".vtt")
	if _, err := os.Stat(cached); err == nil {
		// Bump mtime so the startup sweeper treats this file as recently used.
		now := time.Now()
		_ = os.Chtimes(cached, now, now)
		return connect.NewResponse(&relaxv1.DownloadSubtitleResponse{
			Url: s.subtitleURL(cacheKey),
		}), nil
	}

	vtt, err := provider.Download(ctx, providerRef)
	if errors.Is(err, subtitles.ErrQuotaExceeded) {
		return nil, connect.NewError(connect.CodeResourceExhausted, errors.New("subtitle download quota exceeded"))
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("subtitle download failed: %w", err))
	}

	if err := os.MkdirAll(s.subtitleCache, 0o755); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("subtitle cache: %w", err))
	}
	if err := os.WriteFile(cached, []byte(vtt), 0o644); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("write subtitle: %w", err))
	}
	return connect.NewResponse(&relaxv1.DownloadSubtitleResponse{
		Url: s.subtitleURL(cacheKey),
	}), nil
}

func (s *RelaxServer) subtitleURL(key string) string {
	return fmt.Sprintf("http://localhost:%d/subtitles/%s.vtt", s.port, key)
}

// SweepSubtitleCache deletes cached .vtt files in dir whose mtime is older
// than ttlDays. mtime is bumped on each cache hit (see DownloadSubtitle), so
// this approximates last-accessed eviction. Pass ttlDays<=0 to disable.
func SweepSubtitleCache(dir string, ttlDays int) {
	if ttlDays <= 0 || dir == "" {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		// Missing dir is fine — first run hasn't created it yet.
		return
	}
	cutoff := time.Now().AddDate(0, 0, -ttlDays)
	deleted := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".vtt") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(filepath.Join(dir, e.Name())); err == nil {
				deleted++
			}
		}
	}
	if deleted > 0 {
		slog.Info("subtitle cache: aged out files", "count", deleted, "ttl_days", ttlDays)
	}
}
