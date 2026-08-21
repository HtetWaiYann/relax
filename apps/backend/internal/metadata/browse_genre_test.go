package metadata

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	relaxv1 "relax/gen/relax/v1"
)

// Verifies genre_id reaches TMDB as with_genres and that a filtered page does
// not collide with the unfiltered page in the cache (distinct cache keys).
func TestBrowseMoviesGenreFilter(t *testing.T) {
	var gotGenres []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotGenres = append(gotGenres, r.URL.Query().Get("with_genres"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"page":1,"total_pages":1,"results":[]}`))
	}))
	defer srv.Close()

	c := &Client{apiKey: "x", baseURL: srv.URL, http: srv.Client(), cache: newCache(cacheTTL)}
	ctx := context.Background()

	if _, err := c.BrowseMovies(ctx, 1, 0); err != nil {
		t.Fatalf("unfiltered: %v", err)
	}
	if _, err := c.BrowseMovies(ctx, 1, 28); err != nil {
		t.Fatalf("filtered: %v", err)
	}

	if len(gotGenres) != 2 {
		t.Fatalf("expected 2 upstream calls (distinct cache keys), got %d", len(gotGenres))
	}
	if gotGenres[0] != "" {
		t.Errorf("unfiltered call sent with_genres=%q, want empty", gotGenres[0])
	}
	if gotGenres[1] != "28" {
		t.Errorf("filtered call sent with_genres=%q, want 28", gotGenres[1])
	}
}

func TestGenresEndpoint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/genre/tv/list" {
			t.Errorf("wrong path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"genres":[{"id":16,"name":"Animation"}]}`))
	}))
	defer srv.Close()

	c := &Client{apiKey: "x", baseURL: srv.URL, http: srv.Client(), cache: newCache(cacheTTL)}
	got, err := c.Genres(context.Background(), relaxv1.MediaType_MEDIA_TYPE_TV)
	if err != nil {
		t.Fatalf("Genres: %v", err)
	}
	if len(got) != 1 || got[0].GetId() != 16 || got[0].GetName() != "Animation" {
		t.Fatalf("unexpected genres: %+v", got)
	}
}
