package metadata

import (
	"encoding/json"
	"testing"

	relaxv1 "relax/gen/relax/v1"
)

func TestMovieDetailMapping(t *testing.T) {
	raw := `{
		"id": 27205,
		"title": "Inception",
		"poster_path": "/p.jpg",
		"backdrop_path": "/b.jpg",
		"release_date": "2010-07-15",
		"vote_average": 8.4,
		"overview": "A thief.",
		"runtime": 148,
		"tagline": "Your mind is the scene of the crime.",
		"status": "Released",
		"original_language": "en",
		"genres": [{"id": 28, "name": "Action"}, {"id": 878, "name": "Sci-Fi"}],
		"production_countries": [{"iso_3166_1": "US", "name": "United States"}],
		"credits": {"cast": [
			{"id": 1, "name": "Leo", "character": "Cobb", "profile_path": "/leo.jpg", "order": 0},
			{"id": 2, "name": "Ellen", "character": "Ariadne", "profile_path": "/ellen.jpg", "order": 1}
		]},
		"similar": {"results": [
			{"id": 999, "title": "Tenet", "poster_path": "/t.jpg", "release_date": "2020-08-22", "vote_average": 7.4}
		]}
	}`
	var d tmdbMovieDetail
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	got := movieDetailToProto(d)

	assertEq(t, "title", got.GetSummary().GetTitle(), "Inception")
	assertEq(t, "release_date", got.GetSummary().GetReleaseDate(), "2010-07-15")
	assertEq(t, "media_type", got.GetSummary().GetMediaType(), relaxv1.MediaType_MEDIA_TYPE_MOVIE)
	assertEq(t, "runtime", got.GetRuntimeMinutes(), int32(148))
	assertEq(t, "tagline", got.GetTagline(), "Your mind is the scene of the crime.")
	assertEq(t, "poster_url", got.GetSummary().GetPosterUrl(), "https://image.tmdb.org/t/p/w342/p.jpg")
	assertEq(t, "genre_count", len(got.GetGenres()), 2)
	assertEq(t, "cast_count", len(got.GetCast()), 2)
	assertEq(t, "cast[0] profile", got.GetCast()[0].GetProfileUrl(), "https://image.tmdb.org/t/p/w185/leo.jpg")
	assertEq(t, "similar_count", len(got.GetSimilar()), 1)
	assertEq(t, "similar[0] type", got.GetSimilar()[0].GetMediaType(), relaxv1.MediaType_MEDIA_TYPE_MOVIE)
}

func TestTVDetailMapping(t *testing.T) {
	raw := `{
		"id": 1399,
		"name": "Game of Thrones",
		"poster_path": "/got.jpg",
		"first_air_date": "2011-04-17",
		"vote_average": 8.5,
		"overview": "Seven noble families.",
		"episode_run_time": [60, 50],
		"tagline": "Winter is coming.",
		"status": "Ended",
		"original_language": "en",
		"genres": [{"id": 18, "name": "Drama"}],
		"production_countries": [{"iso_3166_1": "US", "name": "United States"}],
		"credits": {"cast": []},
		"similar": {"results": [
			{"id": 1402, "name": "The Walking Dead", "poster_path": "/twd.jpg", "first_air_date": "2010-10-31", "vote_average": 7.9}
		]}
	}`
	var d tmdbTVDetail
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	got := tvDetailToProto(d)

	assertEq(t, "title", got.GetSummary().GetTitle(), "Game of Thrones")
	assertEq(t, "release_date (from first_air_date)", got.GetSummary().GetReleaseDate(), "2011-04-17")
	assertEq(t, "media_type", got.GetSummary().GetMediaType(), relaxv1.MediaType_MEDIA_TYPE_TV)
	assertEq(t, "runtime (mean of [60,50])", got.GetRuntimeMinutes(), int32(55))
	assertEq(t, "similar[0] title (from name)", got.GetSimilar()[0].GetTitle(), "The Walking Dead")
	assertEq(t, "similar[0] type", got.GetSimilar()[0].GetMediaType(), relaxv1.MediaType_MEDIA_TYPE_TV)
}

func TestMultiSearchDropsPersons(t *testing.T) {
	raw := `{"page":1,"total_pages":1,"total_results":3,"results":[
		{"media_type":"movie","id":1,"title":"M","poster_path":"/m.jpg","release_date":"2020-01-01","vote_average":7.0},
		{"media_type":"person","id":2,"name":"Actor","profile_path":"/a.jpg"},
		{"media_type":"tv","id":3,"name":"T","poster_path":"/t.jpg","first_air_date":"2021-01-01","vote_average":8.0}
	]}`
	var raw2 tmdbPaginated[tmdbMultiResult]
	if err := json.Unmarshal([]byte(raw), &raw2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var got []*relaxv1.MediaSummary
	for _, r := range raw2.Results {
		if s := multiToSummary(r); s != nil {
			got = append(got, s)
		}
	}
	assertEq(t, "results after person drop", len(got), 2)
	assertEq(t, "first is movie", got[0].GetMediaType(), relaxv1.MediaType_MEDIA_TYPE_MOVIE)
	assertEq(t, "second is tv", got[1].GetMediaType(), relaxv1.MediaType_MEDIA_TYPE_TV)
	assertEq(t, "tv title from name", got[1].GetTitle(), "T")
}

func TestImageURLEmptyPath(t *testing.T) {
	assertEq(t, "empty poster", posterURL(""), "")
	assertEq(t, "non-empty poster", posterURL("/a.jpg"), "https://image.tmdb.org/t/p/w342/a.jpg")
}

func assertEq[T comparable](t *testing.T, field string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %v, want %v", field, got, want)
	}
}
