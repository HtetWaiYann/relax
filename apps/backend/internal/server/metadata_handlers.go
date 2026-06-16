package server

import (
	"context"
	"errors"
	"net/http"

	"connectrpc.com/connect"

	relaxv1 "relax/gen/relax/v1"
	"relax/internal/metadata"
)

func (s *RelaxServer) GetHomeSections(
	ctx context.Context,
	_ *connect.Request[relaxv1.GetHomeSectionsRequest],
) (*connect.Response[relaxv1.GetHomeSectionsResponse], error) {
	sections, featured, err := s.meta.GetHomeSections(ctx)
	if err != nil {
		return nil, s.tmdbError("GetHomeSections", err)
	}
	return connect.NewResponse(&relaxv1.GetHomeSectionsResponse{
		Sections: sections,
		Featured: featured,
	}), nil
}

func (s *RelaxServer) SearchMedia(
	ctx context.Context,
	req *connect.Request[relaxv1.SearchMediaRequest],
) (*connect.Response[relaxv1.SearchMediaResponse], error) {
	if err := requireNonEmpty("query", req.Msg.GetQuery()); err != nil {
		return nil, err
	}
	resp, err := s.meta.SearchMulti(ctx, req.Msg.GetQuery(), req.Msg.GetPage())
	if err != nil {
		return nil, s.tmdbError("SearchMedia", err)
	}
	// Optional client-side filter — server-side /search/multi already drops
	// person results in the mapping layer.
	if mt := req.Msg.GetMediaType(); mt != relaxv1.MediaType_MEDIA_TYPE_UNSPECIFIED {
		filtered := resp.Results[:0]
		for _, r := range resp.Results {
			if r.GetMediaType() == mt {
				filtered = append(filtered, r)
			}
		}
		resp.Results = filtered
	}
	return connect.NewResponse(resp), nil
}

func (s *RelaxServer) GetMediaDetail(
	ctx context.Context,
	req *connect.Request[relaxv1.GetMediaDetailRequest],
) (*connect.Response[relaxv1.GetMediaDetailResponse], error) {
	id := req.Msg.GetTmdbId()
	if id <= 0 {
		return nil, invalidArg("tmdb_id must be positive")
	}
	var (
		detail *relaxv1.MediaDetail
		err    error
	)
	switch req.Msg.GetMediaType() {
	case relaxv1.MediaType_MEDIA_TYPE_MOVIE:
		detail, err = s.meta.GetMovieDetail(ctx, id)
	case relaxv1.MediaType_MEDIA_TYPE_TV:
		detail, err = s.meta.GetTVDetail(ctx, id)
	default:
		return nil, invalidArg("media_type must be MOVIE or TV")
	}
	if err != nil {
		return nil, s.tmdbError("GetMediaDetail", err)
	}
	return connect.NewResponse(&relaxv1.GetMediaDetailResponse{Detail: detail}), nil
}

func (s *RelaxServer) BrowseMedia(
	ctx context.Context,
	req *connect.Request[relaxv1.BrowseMediaRequest],
) (*connect.Response[relaxv1.BrowseMediaResponse], error) {
	page := req.Msg.GetPage()
	if page < 0 {
		return nil, invalidArg("page must be >= 0")
	}
	var (
		resp *relaxv1.BrowseMediaResponse
		err  error
	)
	switch req.Msg.GetMediaType() {
	case relaxv1.MediaType_MEDIA_TYPE_MOVIE:
		resp, err = s.meta.BrowseMovies(ctx, page)
	case relaxv1.MediaType_MEDIA_TYPE_TV:
		resp, err = s.meta.BrowseTV(ctx, page, req.Msg.GetAnime())
	default:
		return nil, invalidArg("media_type must be MOVIE or TV")
	}
	if err != nil {
		return nil, s.tmdbError("BrowseMedia", err)
	}
	return connect.NewResponse(resp), nil
}

func (s *RelaxServer) GetPersonDetail(
	ctx context.Context,
	req *connect.Request[relaxv1.GetPersonDetailRequest],
) (*connect.Response[relaxv1.GetPersonDetailResponse], error) {
	id := req.Msg.GetPersonId()
	if id <= 0 {
		return nil, invalidArg("person_id must be positive")
	}
	detail, err := s.meta.GetPersonDetail(ctx, id)
	if err != nil {
		return nil, s.tmdbError("GetPersonDetail", err)
	}
	return connect.NewResponse(&relaxv1.GetPersonDetailResponse{Detail: detail}), nil
}

// tmdbError maps a TMDB APIError to a Connect code without leaking the
// upstream body to the renderer. Server log keeps the raw status for ops.
func (s *RelaxServer) tmdbError(op string, err error) error {
	if apiErr, ok := metadata.AsAPIError(err); ok {
		s.logger.Warn("tmdb error", "op", op, "status", apiErr.Status, "msg", apiErr.Message)
		switch apiErr.Status {
		case http.StatusNotFound:
			return connect.NewError(connect.CodeNotFound, errors.New("title not found"))
		case http.StatusTooManyRequests:
			return connect.NewError(connect.CodeResourceExhausted, errors.New("rate limited, retry shortly"))
		case http.StatusUnauthorized, http.StatusForbidden:
			return connect.NewError(connect.CodeUnauthenticated, errors.New("metadata provider not configured"))
		default:
			return connect.NewError(connect.CodeUnavailable, errors.New("metadata provider unavailable"))
		}
	}
	s.logger.Error("tmdb internal error", "op", op, "err", err)
	return connect.NewError(connect.CodeInternal, errors.New("internal error"))
}
