package server

import (
	"context"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	relaxv1 "relax/gen/relax/v1"
	"relax/gen/relax/v1/relaxv1connect"
	"relax/internal/metadata"
	"relax/internal/storage"
	"relax/internal/streams"
	"relax/internal/subtitles"
)

// MinPersistSeconds: don't persist accidental clicks/auto-plays as resume
// points. Mirrors the spec — position > 5s and a known duration.
const MinPersistSeconds = 5.0

// RelaxServer is a partial implementation of relaxv1connect.RelaxServiceHandler.
// Metadata RPCs (GetHomeSections/SearchMedia/GetMediaDetail) use a real TMDB
// client; torrent/storage RPCs still return stub data until those layers land.
type RelaxServer struct {
	logger        *slog.Logger
	meta          *metadata.Client
	streams       streams.Provider
	subtitles     map[string]subtitles.Provider // keyed by Provider.Name()
	subtitleCache string
	port          int
	store         storage.Store
}

var _ relaxv1connect.RelaxServiceHandler = (*RelaxServer)(nil)

func NewRelaxServer(
	logger *slog.Logger,
	meta *metadata.Client,
	streamsProvider streams.Provider,
	subtitleProviders []subtitles.Provider,
	subtitleCache string,
	port int,
	store storage.Store,
) *RelaxServer {
	providers := make(map[string]subtitles.Provider, len(subtitleProviders))
	for _, p := range subtitleProviders {
		if p == nil {
			continue
		}
		providers[p.Name()] = p
	}
	return &RelaxServer{
		logger:        logger,
		meta:          meta,
		streams:       streamsProvider,
		subtitles:     providers,
		subtitleCache: subtitleCache,
		port:          port,
		store:         store,
	}
}

func (s *RelaxServer) Search(
	_ context.Context,
	req *connect.Request[relaxv1.SearchRequest],
) (*connect.Response[relaxv1.SearchResponse], error) {
	if err := requireNonEmpty("query", req.Msg.GetQuery()); err != nil {
		return nil, err
	}
	s.logger.Info("Search", "query", req.Msg.GetQuery())

	results := []*relaxv1.SearchResult{
		{
			Score: 0.98,
			Metadata: &relaxv1.MediaMetadata{
				Title:          "Inception",
				Year:           2010,
				TmdbId:         "27205",
				PosterUrl:      "https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
				Overview:       "A thief who steals corporate secrets through dream-sharing technology.",
				Genres:         []string{"Action", "Sci-Fi", "Thriller"},
				RuntimeMinutes: 148,
			},
		},
		{
			Score: 0.95,
			Metadata: &relaxv1.MediaMetadata{
				Title:          "The Matrix",
				Year:           1999,
				TmdbId:         "603",
				PosterUrl:      "https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
				Overview:       "A computer hacker learns about the true nature of reality.",
				Genres:         []string{"Action", "Sci-Fi"},
				RuntimeMinutes: 136,
			},
		},
	}

	return connect.NewResponse(&relaxv1.SearchResponse{
		Results: results,
		Total:   int32(len(results)),
	}), nil
}

func (s *RelaxServer) AddTorrent(
	_ context.Context,
	req *connect.Request[relaxv1.AddTorrentRequest],
) (*connect.Response[relaxv1.AddTorrentResponse], error) {
	if err := requireMagnet(req.Msg.GetMagnetUri()); err != nil {
		return nil, err
	}
	return connect.NewResponse(&relaxv1.AddTorrentResponse{
		Torrent: &relaxv1.Torrent{
			Id:        "stub-" + req.Msg.GetMediaId(),
			MagnetUri: req.Msg.GetMagnetUri(),
			Name:      "placeholder torrent",
			Status:    relaxv1.TorrentStatus_TORRENT_STATUS_IDLE,
		},
	}), nil
}

func (s *RelaxServer) RemoveTorrent(
	_ context.Context,
	req *connect.Request[relaxv1.RemoveTorrentRequest],
) (*connect.Response[relaxv1.RemoveTorrentResponse], error) {
	if err := requireNonEmpty("torrent_id", req.Msg.GetTorrentId()); err != nil {
		return nil, err
	}
	return connect.NewResponse(&relaxv1.RemoveTorrentResponse{Removed: true}), nil
}

func (s *RelaxServer) GetMetadata(
	_ context.Context,
	req *connect.Request[relaxv1.GetMetadataRequest],
) (*connect.Response[relaxv1.GetMetadataResponse], error) {
	if err := requireNonEmpty("tmdb_id", req.Msg.GetTmdbId()); err != nil {
		return nil, err
	}
	return connect.NewResponse(&relaxv1.GetMetadataResponse{
		Metadata: &relaxv1.MediaMetadata{
			Title:          "Placeholder Movie",
			Year:           2026,
			TmdbId:         req.Msg.GetTmdbId(),
			Overview:       "Stub metadata response.",
			Genres:         []string{"Demo"},
			RuntimeMinutes: 90,
		},
	}), nil
}

func (s *RelaxServer) UpsertWatchProgress(
	ctx context.Context,
	req *connect.Request[relaxv1.UpsertWatchProgressRequest],
) (*connect.Response[relaxv1.UpsertWatchProgressResponse], error) {
	p := req.Msg.GetProgress()
	if p == nil {
		return nil, invalidArg("progress is required")
	}
	if err := requireNonEmpty("media_id", p.GetMediaId()); err != nil {
		return nil, err
	}
	if p.GetPositionSeconds() <= MinPersistSeconds || p.GetDurationSeconds() <= 0 {
		return connect.NewResponse(&relaxv1.UpsertWatchProgressResponse{}), nil
	}
	if err := requireNonEmpty("magnet_uri", p.GetMagnetUri()); err != nil {
		return nil, err
	}
	last := time.Now().UTC()
	if ts := p.GetLastWatchedAt(); ts != nil {
		last = ts.AsTime()
	}
	if err := s.store.Upsert(ctx, storage.WatchProgress{
		MediaID:         p.GetMediaId(),
		MediaType:       int32(p.GetMediaType()),
		Title:           p.GetTitle(),
		PosterURL:       p.GetPosterUrl(),
		Season:          p.GetSeason(),
		Episode:         p.GetEpisode(),
		PositionSeconds: p.GetPositionSeconds(),
		DurationSeconds: p.GetDurationSeconds(),
		LastWatchedAt:   last,
		InfoHash:        p.GetInfoHash(),
		FileIdx:         p.GetFileIdx(),
		MagnetURI:       p.GetMagnetUri(),
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&relaxv1.UpsertWatchProgressResponse{}), nil
}

func (s *RelaxServer) GetWatchProgress(
	ctx context.Context,
	req *connect.Request[relaxv1.GetWatchProgressRequest],
) (*connect.Response[relaxv1.GetWatchProgressResponse], error) {
	if err := requireNonEmpty("media_id", req.Msg.GetMediaId()); err != nil {
		return nil, err
	}
	p, found, err := s.store.Get(ctx, req.Msg.GetMediaId(), int32(req.Msg.GetMediaType()), req.Msg.GetSeason(), req.Msg.GetEpisode())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !found {
		return connect.NewResponse(&relaxv1.GetWatchProgressResponse{Found: false}), nil
	}
	return connect.NewResponse(&relaxv1.GetWatchProgressResponse{Progress: toProto(p), Found: true}), nil
}

func (s *RelaxServer) GetWatchHistory(
	ctx context.Context,
	req *connect.Request[relaxv1.GetWatchHistoryRequest],
) (*connect.Response[relaxv1.GetWatchHistoryResponse], error) {
	rows, total, err := s.store.History(ctx, int(req.Msg.GetLimit()), int(req.Msg.GetOffset()))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*relaxv1.WatchProgress, len(rows))
	for i, r := range rows {
		items[i] = toProto(r)
	}
	return connect.NewResponse(&relaxv1.GetWatchHistoryResponse{Items: items, TotalCount: int32(total)}), nil
}

func (s *RelaxServer) DeleteWatchProgress(
	ctx context.Context,
	req *connect.Request[relaxv1.DeleteWatchProgressRequest],
) (*connect.Response[relaxv1.DeleteWatchProgressResponse], error) {
	if err := requireNonEmpty("media_id", req.Msg.GetMediaId()); err != nil {
		return nil, err
	}
	if err := s.store.Delete(ctx, req.Msg.GetMediaId(), int32(req.Msg.GetMediaType()), req.Msg.GetSeason(), req.Msg.GetEpisode()); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&relaxv1.DeleteWatchProgressResponse{}), nil
}

func (s *RelaxServer) ClearWatchHistory(
	ctx context.Context,
	_ *connect.Request[relaxv1.ClearWatchHistoryRequest],
) (*connect.Response[relaxv1.ClearWatchHistoryResponse], error) {
	if err := s.store.Clear(ctx); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&relaxv1.ClearWatchHistoryResponse{}), nil
}

func toProto(p storage.WatchProgress) *relaxv1.WatchProgress {
	return &relaxv1.WatchProgress{
		MediaId:         p.MediaID,
		MediaType:       relaxv1.MediaType(p.MediaType),
		Title:           p.Title,
		PosterUrl:       p.PosterURL,
		Season:          p.Season,
		Episode:         p.Episode,
		PositionSeconds: p.PositionSeconds,
		DurationSeconds: p.DurationSeconds,
		LastWatchedAt:   timestamppb.New(p.LastWatchedAt),
		InfoHash:        p.InfoHash,
		FileIdx:         p.FileIdx,
		MagnetUri:       p.MagnetURI,
	}
}

func (s *RelaxServer) StreamTorrentProgress(
	ctx context.Context,
	req *connect.Request[relaxv1.StreamTorrentProgressRequest],
	stream *connect.ServerStream[relaxv1.TorrentProgressUpdate],
) error {
	if err := requireNonEmpty("torrent_id", req.Msg.GetTorrentId()); err != nil {
		return err
	}
	id := req.Msg.GetTorrentId()
	for i := 0; i < 5; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
		update := &relaxv1.TorrentProgressUpdate{
			Torrent: &relaxv1.Torrent{
				Id:               id,
				Name:             "placeholder torrent",
				Status:           relaxv1.TorrentStatus_TORRENT_STATUS_DOWNLOADING,
				ProgressPct:      float64(i+1) * 20.0,
				DownloadSpeedBps: 1_000_000,
				PeerCount:        int32(10 + i),
			},
		}
		if err := stream.Send(update); err != nil {
			return err
		}
	}
	return nil
}
