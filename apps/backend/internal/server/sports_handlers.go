package server

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"

	relaxv1 "relax/gen/relax/v1"
	"relax/internal/sports"
)

// WithSports wires the Sports RPCs. Kept off NewRelaxServer so the existing
// constructor (and its tests) stay unchanged.
func (s *RelaxServer) WithSports(f *sports.Fixtures, a *sports.Addon, p *sports.Proxy) *RelaxServer {
	s.fixtures, s.addon, s.liveProxy = f, a, p
	return s
}

func (s *RelaxServer) GetTodayMatches(
	ctx context.Context,
	req *connect.Request[relaxv1.GetTodayMatchesRequest],
) (*connect.Response[relaxv1.GetTodayMatchesResponse], error) {
	start, end := req.Msg.GetDayStart(), req.Msg.GetDayEnd()
	if start == nil || end == nil || !end.AsTime().After(start.AsTime()) {
		return nil, invalidArg("day_start and day_end are required and day_end must be after day_start")
	}
	matches, err := s.fixtures.Between(ctx, start.AsTime(), end.AsTime())
	if err != nil {
		return nil, s.fixturesError("GetTodayMatches", err)
	}
	return connect.NewResponse(&relaxv1.GetTodayMatchesResponse{Matches: matches}), nil
}

func (s *RelaxServer) GetMatchStreams(
	ctx context.Context,
	req *connect.Request[relaxv1.GetMatchStreamsRequest],
) (*connect.Response[relaxv1.GetMatchStreamsResponse], error) {
	if req.Msg.GetMatchId() <= 0 {
		return nil, invalidArg("match_id must be positive")
	}
	match, err := s.fixtures.ByID(ctx, req.Msg.GetMatchId())
	if err != nil {
		return nil, s.fixturesError("GetMatchStreams", err)
	}
	out := &relaxv1.GetMatchStreamsResponse{Match: match, SourceConfigured: s.addon.Configured()}
	if !out.SourceConfigured {
		return connect.NewResponse(out), nil
	}

	home := []string{match.GetHome().GetName(), match.GetHome().GetShortName()}
	away := []string{match.GetAway().GetName(), match.GetAway().GetShortName()}
	raw, err := s.addon.StreamsFor(ctx, home, away)
	if err != nil {
		// Same policy as GetStreams' providers: a flaky source shows
		// "no streams" rather than failing the whole page.
		s.logger.Warn("sports addon failed", "match_id", match.GetId(), "err", err)
		return connect.NewResponse(out), nil
	}
	for _, r := range raw {
		playURL, err := s.liveProxy.Register(r.URL, r.BehaviorHints.ProxyHeaders.Request)
		if err != nil {
			continue
		}
		title := r.Title
		if title == "" {
			title = r.Description
		}
		out.Streams = append(out.Streams, &relaxv1.LiveStream{
			Name:    strings.ReplaceAll(strings.TrimSpace(r.Name), "\n", " "),
			Title:   strings.TrimSpace(title),
			PlayUrl: playURL,
		})
	}
	return connect.NewResponse(out), nil
}

func (s *RelaxServer) fixturesError(op string, err error) error {
	if errors.Is(err, sports.ErrNoAPIKey) {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	s.logger.Warn("fixtures request failed", "op", op, "err", err)
	return connect.NewError(connect.CodeUnavailable, errors.New("fixtures provider unavailable"))
}
