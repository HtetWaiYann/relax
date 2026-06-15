package server

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"connectrpc.com/connect"

	relaxv1 "relax/gen/relax/v1"
	"relax/internal/subtitles/opensubtitles"
)

var safeRef = regexp.MustCompile(`^[0-9]+$`)

func (s *RelaxServer) SearchSubtitles(
	ctx context.Context,
	req *connect.Request[relaxv1.SearchSubtitlesRequest],
) (*connect.Response[relaxv1.SearchSubtitlesResponse], error) {
	tmdbID := req.Msg.GetTmdbId()
	if tmdbID <= 0 {
		return nil, invalidArg("tmdb_id must be positive")
	}
	if s.subtitles == nil {
		return connect.NewResponse(&relaxv1.SearchSubtitlesResponse{}), nil
	}

	mt := req.Msg.GetMediaType()
	imdbID, err := s.meta.IMDBID(ctx, mt, tmdbID)
	if err != nil || imdbID == "" {
		s.logger.Warn("SearchSubtitles: IMDBID resolution failed", "err", err, "tmdb_id", tmdbID)
		return connect.NewResponse(&relaxv1.SearchSubtitlesResponse{}), nil
	}

	tracks, err := s.subtitles.Search(ctx, imdbID, req.Msg.GetSeason(), req.Msg.GetEpisode())
	if err != nil {
		s.logger.Warn("SearchSubtitles: search failed", "err", err)
		return connect.NewResponse(&relaxv1.SearchSubtitlesResponse{}), nil
	}
	return connect.NewResponse(&relaxv1.SearchSubtitlesResponse{Tracks: tracks}), nil
}

func (s *RelaxServer) DownloadSubtitle(
	ctx context.Context,
	req *connect.Request[relaxv1.DownloadSubtitleRequest],
) (*connect.Response[relaxv1.DownloadSubtitleResponse], error) {
	ref := req.Msg.GetTrackReference()
	if ref == "" || !safeRef.MatchString(ref) {
		return nil, invalidArg("track_reference must be a numeric file id")
	}
	if s.subtitles == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("subtitle provider not configured"))
	}

	cached := filepath.Join(s.subtitleCache, ref+".vtt")
	if _, err := os.Stat(cached); err == nil {
		return connect.NewResponse(&relaxv1.DownloadSubtitleResponse{
			Url: s.subtitleURL(ref),
		}), nil
	}

	vtt, err := s.subtitles.Download(ctx, ref)
	if errors.Is(err, opensubtitles.ErrQuotaExceeded) {
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
		Url: s.subtitleURL(ref),
	}), nil
}

func (s *RelaxServer) subtitleURL(ref string) string {
	return fmt.Sprintf("http://localhost:%d/subtitles/%s.vtt", s.port, ref)
}
