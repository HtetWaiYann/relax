package server

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	relaxv1 "relax/gen/relax/v1"
)

func (s *RelaxServer) GetStreams(
	ctx context.Context,
	req *connect.Request[relaxv1.GetStreamsRequest],
) (*connect.Response[relaxv1.GetStreamsResponse], error) {
	tmdbID := req.Msg.GetTmdbId()
	if tmdbID <= 0 {
		return nil, invalidArg("tmdb_id must be positive")
	}
	mt := req.Msg.GetMediaType()
	if mt != relaxv1.MediaType_MEDIA_TYPE_MOVIE && mt != relaxv1.MediaType_MEDIA_TYPE_TV {
		return nil, invalidArg("media_type must be MOVIE or TV")
	}

	var season, episode *int32
	if mt == relaxv1.MediaType_MEDIA_TYPE_TV {
		se, ep := req.Msg.GetSeason(), req.Msg.GetEpisode()
		if se <= 0 || ep <= 0 {
			return nil, invalidArg("season and episode are required for TV streams")
		}
		season, episode = &se, &ep
	}

	imdbID, err := s.meta.IMDBID(ctx, mt, tmdbID)
	if err != nil {
		return nil, s.tmdbError("GetStreams.IMDBID", err)
	}
	if imdbID == "" {
		s.logger.Warn("no imdb id for tmdb id", "tmdb_id", tmdbID, "media_type", mt)
		return connect.NewResponse(&relaxv1.GetStreamsResponse{}), nil
	}

	src, err := s.streams.GetStreams(ctx, imdbID, mt, season, episode)
	if err != nil {
		s.logger.Warn("streams provider failed", "err", err, "imdb_id", imdbID)
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("stream provider unavailable"))
	}
	return connect.NewResponse(&relaxv1.GetStreamsResponse{Streams: src}), nil
}
