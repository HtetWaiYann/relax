// Package metadata wraps TMDB v3 and maps responses to the proto contract.
package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"golang.org/x/sync/errgroup"

	relaxv1 "relax/gen/relax/v1"
)

const (
	defaultBaseURL = "https://api.themoviedb.org/3"
	defaultTimeout = 10 * time.Second
	cacheTTL       = 1 * time.Hour
)

// Client talks to TMDB. Construct with New; safe for concurrent use.
type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
	cache   *cache
}

// New returns a TMDB client. apiKey must be a v4 read-access token
// (Bearer-style). An empty key disables network calls — every method will
// return an APIError with status 401 so callers see a consistent shape in dev.
func New(apiKey string) *Client {
	return &Client{
		apiKey:  apiKey,
		baseURL: defaultBaseURL,
		http:    &http.Client{Timeout: defaultTimeout},
		cache:   newCache(cacheTTL),
	}
}

func (c *Client) do(ctx context.Context, path string, query url.Values, out any) error {
	if c.apiKey == "" {
		return &APIError{Status: http.StatusUnauthorized, Message: "TMDB_API_KEY not configured"}
	}
	u := c.baseURL + path
	if query != nil {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return &APIError{Status: 0, Message: err.Error()}
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := http.StatusText(resp.StatusCode)
		var berr tmdbErrorBody
		if json.Unmarshal(body, &berr) == nil && berr.StatusMessage != "" {
			msg = berr.StatusMessage
		}
		return &APIError{Status: resp.StatusCode, Message: msg}
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

// getCached fetches `path?query` JSON into a fresh value of type T, caching
// the unmarshalled result under cacheKey for the client's TTL.
func getCached[T any](ctx context.Context, c *Client, cacheKey, path string, query url.Values) (T, error) {
	if v, ok := c.cache.get(cacheKey); ok {
		if typed, ok := v.(T); ok {
			return typed, nil
		}
	}
	var out T
	if err := c.do(ctx, path, query, &out); err != nil {
		return out, err
	}
	c.cache.set(cacheKey, out)
	return out, nil
}

// GetHomeSections fetches the 5 homepage rows in parallel plus a "featured"
// detail (the #1 trending movie) for the hero. Sections appear in the order
// the proto enum lists them.
func (c *Client) GetHomeSections(ctx context.Context) ([]*relaxv1.HomeSection, *relaxv1.MediaDetail, error) {
	type movieList = tmdbPaginated[tmdbMovie]
	type tvList = tmdbPaginated[tmdbTV]

	var (
		popMovies, topMovies, trending movieList
		popTV, topTV                   tvList
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) {
		popMovies, err = getCached[movieList](gctx, c, "movie/popular", "/movie/popular", url.Values{"page": {"1"}})
		return
	})
	g.Go(func() (err error) {
		topMovies, err = getCached[movieList](gctx, c, "movie/top_rated", "/movie/top_rated", url.Values{"page": {"1"}})
		return
	})
	g.Go(func() (err error) {
		trending, err = getCached[movieList](gctx, c, "trending/movie/week", "/trending/movie/week", nil)
		return
	})
	g.Go(func() (err error) {
		popTV, err = getCached[tvList](gctx, c, "tv/popular", "/tv/popular", url.Values{"page": {"1"}})
		return
	})
	g.Go(func() (err error) {
		topTV, err = getCached[tvList](gctx, c, "tv/top_rated", "/tv/top_rated", url.Values{"page": {"1"}})
		return
	})
	if err := g.Wait(); err != nil {
		return nil, nil, err
	}

	sections := []*relaxv1.HomeSection{
		{Category: relaxv1.HomeCategory_HOME_CATEGORY_POPULAR_MOVIES, Label: "Popular Movies", Items: mapSlice(popMovies.Results, movieToSummary)},
		{Category: relaxv1.HomeCategory_HOME_CATEGORY_TOP_RATED_MOVIES, Label: "Top Rated Movies", Items: mapSlice(topMovies.Results, movieToSummary)},
		{Category: relaxv1.HomeCategory_HOME_CATEGORY_TRENDING_MOVIES, Label: "Trending This Week", Items: mapSlice(trending.Results, movieToSummary)},
		{Category: relaxv1.HomeCategory_HOME_CATEGORY_POPULAR_TV, Label: "Popular Series", Items: mapSlice(popTV.Results, tvToSummary)},
		{Category: relaxv1.HomeCategory_HOME_CATEGORY_TOP_RATED_TV, Label: "Top Rated Series", Items: mapSlice(topTV.Results, tvToSummary)},
	}

	var featured *relaxv1.MediaDetail
	if len(trending.Results) > 0 {
		if d, err := c.GetMovieDetail(ctx, trending.Results[0].ID); err == nil {
			featured = d
		}
		// ponytail: hero failure shouldn't blank the home page; rows are the main payload.
	}
	return sections, featured, nil
}

// SearchMulti hits /search/multi and drops person results.
func (c *Client) SearchMulti(ctx context.Context, query string, page int32) (*relaxv1.SearchMediaResponse, error) {
	if page < 1 {
		page = 1
	}
	q := url.Values{
		"query":         {query},
		"page":          {strconv.Itoa(int(page))},
		"include_adult": {"false"},
	}
	// Search is not cached — queries vary too much and we want fresh ranking.
	var raw tmdbPaginated[tmdbMultiResult]
	if err := c.do(ctx, "/search/multi", q, &raw); err != nil {
		return nil, err
	}
	results := make([]*relaxv1.MediaSummary, 0, len(raw.Results))
	for _, r := range raw.Results {
		if s := multiToSummary(r); s != nil {
			results = append(results, s)
		}
	}
	return &relaxv1.SearchMediaResponse{
		Results:      results,
		Page:         raw.Page,
		TotalPages:   raw.TotalPages,
		TotalResults: raw.TotalResults,
	}, nil
}

// GetMovieDetail fetches /movie/{id}?append_to_response=credits,similar.
func (c *Client) GetMovieDetail(ctx context.Context, id int32) (*relaxv1.MediaDetail, error) {
	key := "movie/" + strconv.Itoa(int(id))
	q := url.Values{"append_to_response": {"credits,similar"}}
	d, err := getCached[tmdbMovieDetail](ctx, c, key, "/movie/"+strconv.Itoa(int(id)), q)
	if err != nil {
		return nil, err
	}
	return movieDetailToProto(d), nil
}

// GetTVDetail fetches /tv/{id}?append_to_response=credits,similar.
func (c *Client) GetTVDetail(ctx context.Context, id int32) (*relaxv1.MediaDetail, error) {
	key := "tv/" + strconv.Itoa(int(id))
	q := url.Values{"append_to_response": {"credits,similar"}}
	d, err := getCached[tmdbTVDetail](ctx, c, key, "/tv/"+strconv.Itoa(int(id)), q)
	if err != nil {
		return nil, err
	}
	return tvDetailToProto(d), nil
}

// BrowseMovies hits /discover/movie sorted by popularity, page-paginated.
func (c *Client) BrowseMovies(ctx context.Context, page int32) (*relaxv1.BrowseMediaResponse, error) {
	if page < 1 {
		page = 1
	}
	q := url.Values{
		"page":          {strconv.Itoa(int(page))},
		"sort_by":       {"popularity.desc"},
		"include_adult": {"false"},
	}
	key := "discover/movie?page=" + strconv.Itoa(int(page))
	d, err := getCached[tmdbPaginated[tmdbMovie]](ctx, c, key, "/discover/movie", q)
	if err != nil {
		return nil, err
	}
	return &relaxv1.BrowseMediaResponse{
		Results:    mapSlice(d.Results, movieToSummary),
		Page:       d.Page,
		TotalPages: d.TotalPages,
	}, nil
}

// BrowseTV hits /discover/tv sorted by popularity, page-paginated.
// When anime is true, filters to TV with the Animation genre (16) plus an
// origin of Japan — TMDB's pragmatic "anime" recipe.
func (c *Client) BrowseTV(ctx context.Context, page int32, anime bool) (*relaxv1.BrowseMediaResponse, error) {
	if page < 1 {
		page = 1
	}
	q := url.Values{
		"page":          {strconv.Itoa(int(page))},
		"sort_by":       {"popularity.desc"},
		"include_adult": {"false"},
	}
	keyTag := "tv"
	if anime {
		q.Set("with_genres", "16")
		q.Set("with_original_language", "ja")
		keyTag = "anime"
	}
	key := "discover/" + keyTag + "?page=" + strconv.Itoa(int(page))
	d, err := getCached[tmdbPaginated[tmdbTV]](ctx, c, key, "/discover/tv", q)
	if err != nil {
		return nil, err
	}
	return &relaxv1.BrowseMediaResponse{
		Results:    mapSlice(d.Results, tvToSummary),
		Page:       d.Page,
		TotalPages: d.TotalPages,
	}, nil
}

// GetPersonDetail fetches /person/{id}?append_to_response=combined_credits.
func (c *Client) GetPersonDetail(ctx context.Context, id int32) (*relaxv1.PersonDetail, error) {
	key := "person/" + strconv.Itoa(int(id))
	q := url.Values{"append_to_response": {"combined_credits"}}
	d, err := getCached[tmdbPersonDetail](ctx, c, key, "/person/"+strconv.Itoa(int(id)), q)
	if err != nil {
		return nil, err
	}
	return personDetailToProto(d), nil
}

// AsAPIError unwraps to *APIError if the error chain has one.
func AsAPIError(err error) (*APIError, bool) {
	var e *APIError
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}
