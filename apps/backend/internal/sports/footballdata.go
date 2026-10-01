// Package sports serves today's fixtures (football-data.org), finds live
// streams for a fixture on a Stremio-protocol addon, and proxies the HLS
// playback so upstream headers never reach the renderer.
package sports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	relaxv1 "relax/gen/relax/v1"
)

const (
	footballDataBaseURL = "https://api.football-data.org/v4"
	// Ranges containing "now" may have live scores; other days barely change.
	liveTTL     = 30 * time.Second
	settledTTL  = 10 * time.Minute
	httpTimeout = 10 * time.Second
)

// ErrNoAPIKey is returned when FOOTBALL_DATA_API_KEY is unset.
var ErrNoAPIKey = errors.New("FOOTBALL_DATA_API_KEY is not set")

// Fixtures fetches matches from football-data.org.
type Fixtures struct {
	apiKey       string
	competitions string // comma-separated codes, e.g. "PL,PD"
	http         *http.Client

	mu    sync.Mutex
	cache map[string]fixturesEntry
}

type fixturesEntry struct {
	at      time.Time
	matches []*relaxv1.Match
}

func NewFixtures(apiKey, competitions string) *Fixtures {
	return &Fixtures{
		apiKey:       apiKey,
		competitions: competitions,
		http:         &http.Client{Timeout: httpTimeout},
		cache:        map[string]fixturesEntry{},
	}
}

type fdTeam struct {
	Name      string `json:"name"`
	ShortName string `json:"shortName"`
	Crest     string `json:"crest"`
}

type fdMatch struct {
	ID          int32     `json:"id"`
	UTCDate     time.Time `json:"utcDate"`
	Status      string    `json:"status"`
	Competition struct {
		Code   string `json:"code"`
		Name   string `json:"name"`
		Emblem string `json:"emblem"`
	} `json:"competition"`
	HomeTeam fdTeam `json:"homeTeam"`
	AwayTeam fdTeam `json:"awayTeam"`
	Score    struct {
		FullTime struct {
			Home *int32 `json:"home"`
			Away *int32 `json:"away"`
		} `json:"fullTime"`
	} `json:"score"`
}

// Between returns matches kicking off in [start, end). The free tier allows
// 10 req/min, so results are cached per range (see liveTTL / settledTTL).
func (f *Fixtures) Between(ctx context.Context, start, end time.Time) ([]*relaxv1.Match, error) {
	if f.apiKey == "" {
		return nil, ErrNoAPIKey
	}
	// football-data filters by UTC date; a local day can straddle two. Pad
	// dateTo a day so its inclusive/exclusive semantics don't matter —
	// filterRange trims to the exact window.
	from := start.UTC().Format(time.DateOnly)
	to := end.UTC().AddDate(0, 0, 1).Format(time.DateOnly)
	key := from + "/" + to

	ttl := settledTTL
	if now := time.Now(); !now.Before(start) && now.Before(end) {
		ttl = liveTTL
	}
	f.mu.Lock()
	if e, ok := f.cache[key]; ok && time.Since(e.at) < ttl {
		f.mu.Unlock()
		return filterRange(e.matches, start, end), nil
	}
	f.mu.Unlock()

	q := url.Values{"competitions": {f.competitions}, "dateFrom": {from}, "dateTo": {to}}
	var body struct {
		Matches []fdMatch `json:"matches"`
	}
	if err := f.get(ctx, "/matches?"+q.Encode(), &body); err != nil {
		return nil, err
	}
	matches := make([]*relaxv1.Match, 0, len(body.Matches))
	for _, m := range body.Matches {
		matches = append(matches, toMatch(m))
	}

	f.mu.Lock()
	// ponytail: unbounded, one entry per day browsed this session; add LRU
	// eviction if someone scrolls through whole seasons.
	f.cache[key] = fixturesEntry{at: time.Now(), matches: matches}
	f.mu.Unlock()
	return filterRange(matches, start, end), nil
}

// ByID fetches one match fresh (current score/status).
func (f *Fixtures) ByID(ctx context.Context, id int32) (*relaxv1.Match, error) {
	if f.apiKey == "" {
		return nil, ErrNoAPIKey
	}
	var m fdMatch
	if err := f.get(ctx, fmt.Sprintf("/matches/%d", id), &m); err != nil {
		return nil, err
	}
	return toMatch(m), nil
}

func (f *Fixtures) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, footballDataBaseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Auth-Token", f.apiKey)
	resp, err := f.http.Do(req)
	if err != nil {
		return fmt.Errorf("football-data: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("football-data: status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func filterRange(all []*relaxv1.Match, start, end time.Time) []*relaxv1.Match {
	out := make([]*relaxv1.Match, 0, len(all))
	for _, m := range all {
		k := m.GetKickoff().AsTime()
		if !k.Before(start) && k.Before(end) {
			out = append(out, m)
		}
	}
	return out
}

func toMatch(m fdMatch) *relaxv1.Match {
	out := &relaxv1.Match{
		Id: m.ID,
		Competition: &relaxv1.Competition{
			Code:      m.Competition.Code,
			Name:      m.Competition.Name,
			EmblemUrl: m.Competition.Emblem,
		},
		Home:    &relaxv1.Team{Name: m.HomeTeam.Name, ShortName: m.HomeTeam.ShortName, CrestUrl: m.HomeTeam.Crest},
		Away:    &relaxv1.Team{Name: m.AwayTeam.Name, ShortName: m.AwayTeam.ShortName, CrestUrl: m.AwayTeam.Crest},
		Kickoff: timestamppb.New(m.UTCDate),
		Status:  mapStatus(m.Status),
	}
	if h, a := m.Score.FullTime.Home, m.Score.FullTime.Away; h != nil && a != nil {
		out.HomeScore, out.AwayScore, out.HasScore = *h, *a, true
	}
	return out
}

func mapStatus(s string) relaxv1.MatchStatus {
	switch s {
	case "SCHEDULED", "TIMED":
		return relaxv1.MatchStatus_MATCH_STATUS_SCHEDULED
	case "IN_PLAY", "LIVE":
		return relaxv1.MatchStatus_MATCH_STATUS_LIVE
	case "PAUSED":
		return relaxv1.MatchStatus_MATCH_STATUS_PAUSED
	case "FINISHED", "AWARDED":
		return relaxv1.MatchStatus_MATCH_STATUS_FINISHED
	case "POSTPONED", "SUSPENDED", "CANCELLED":
		return relaxv1.MatchStatus_MATCH_STATUS_POSTPONED
	default:
		return relaxv1.MatchStatus_MATCH_STATUS_UNSPECIFIED
	}
}
