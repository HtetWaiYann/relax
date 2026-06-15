package metadata

import (
	"sort"

	relaxv1 "relax/gen/relax/v1"
)

const castLimit = 12

func movieToSummary(m tmdbMovie) *relaxv1.MediaSummary {
	return &relaxv1.MediaSummary{
		TmdbId:       m.ID,
		MediaType:    relaxv1.MediaType_MEDIA_TYPE_MOVIE,
		Title:        m.Title,
		PosterUrl:    posterURL(m.PosterPath),
		BackdropUrl:  backdropURL(m.BackdropPath),
		ReleaseDate:  m.ReleaseDate,
		VoteAverage:  m.VoteAverage,
		GenreIds:     m.GenreIDs,
	}
}

func tvToSummary(t tmdbTV) *relaxv1.MediaSummary {
	return &relaxv1.MediaSummary{
		TmdbId:       t.ID,
		MediaType:    relaxv1.MediaType_MEDIA_TYPE_TV,
		Title:        t.Name,
		PosterUrl:    posterURL(t.PosterPath),
		BackdropUrl:  backdropURL(t.BackdropPath),
		ReleaseDate:  t.FirstAirDate,
		VoteAverage:  t.VoteAverage,
		GenreIds:     t.GenreIDs,
	}
}

// multiToSummary returns nil for non-movie/tv rows (e.g. person results).
func multiToSummary(r tmdbMultiResult) *relaxv1.MediaSummary {
	switch r.MediaType {
	case "movie":
		return &relaxv1.MediaSummary{
			TmdbId:      r.ID,
			MediaType:   relaxv1.MediaType_MEDIA_TYPE_MOVIE,
			Title:       r.Title,
			PosterUrl:   posterURL(r.PosterPath),
			BackdropUrl: backdropURL(r.BackdropPath),
			ReleaseDate: r.ReleaseDate,
			VoteAverage: r.VoteAverage,
			GenreIds:    r.GenreIDs,
		}
	case "tv":
		return &relaxv1.MediaSummary{
			TmdbId:      r.ID,
			MediaType:   relaxv1.MediaType_MEDIA_TYPE_TV,
			Title:       r.Name,
			PosterUrl:   posterURL(r.PosterPath),
			BackdropUrl: backdropURL(r.BackdropPath),
			ReleaseDate: r.FirstAirDate,
			VoteAverage: r.VoteAverage,
			GenreIds:    r.GenreIDs,
		}
	default:
		return nil
	}
}

func movieDetailToProto(d tmdbMovieDetail) *relaxv1.MediaDetail {
	return &relaxv1.MediaDetail{
		Summary: &relaxv1.MediaSummary{
			TmdbId:      d.ID,
			MediaType:   relaxv1.MediaType_MEDIA_TYPE_MOVIE,
			Title:       d.Title,
			PosterUrl:   posterURL(d.PosterPath),
			BackdropUrl: backdropURL(d.BackdropPath),
			ReleaseDate: d.ReleaseDate,
			VoteAverage: d.VoteAverage,
			GenreIds:    genreIDs(d.Genres),
		},
		Overview:            d.Overview,
		RuntimeMinutes:      d.Runtime,
		Genres:              mapGenres(d.Genres),
		Tagline:             d.Tagline,
		Status:              d.Status,
		OriginalLanguage:    d.OriginalLanguage,
		ProductionCountries: countryNames(d.ProductionCountries),
		Cast:                topCast(d.Credits.Cast),
		Similar:             mapSlice(d.Similar.Results, movieToSummary),
	}
}

func tvDetailToProto(d tmdbTVDetail) *relaxv1.MediaDetail {
	return &relaxv1.MediaDetail{
		Summary: &relaxv1.MediaSummary{
			TmdbId:      d.ID,
			MediaType:   relaxv1.MediaType_MEDIA_TYPE_TV,
			Title:       d.Name,
			PosterUrl:   posterURL(d.PosterPath),
			BackdropUrl: backdropURL(d.BackdropPath),
			ReleaseDate: d.FirstAirDate,
			VoteAverage: d.VoteAverage,
			GenreIds:    genreIDs(d.Genres),
		},
		Overview:            d.Overview,
		RuntimeMinutes:      meanRuntime(d.EpisodeRunTime),
		Genres:              mapGenres(d.Genres),
		Tagline:             d.Tagline,
		Status:              d.Status,
		OriginalLanguage:    d.OriginalLanguage,
		ProductionCountries: countryNames(d.ProductionCountries),
		Cast:                topCast(d.Credits.Cast),
		Similar:             mapSlice(d.Similar.Results, tvToSummary),
	}
}

func mapGenres(in []tmdbGenre) []*relaxv1.Genre {
	out := make([]*relaxv1.Genre, len(in))
	for i, g := range in {
		out[i] = &relaxv1.Genre{Id: g.ID, Name: g.Name}
	}
	return out
}

func genreIDs(in []tmdbGenre) []int32 {
	out := make([]int32, len(in))
	for i, g := range in {
		out[i] = g.ID
	}
	return out
}

func countryNames(in []tmdbProductionCountry) []string {
	out := make([]string, len(in))
	for i, c := range in {
		out[i] = c.Name
	}
	return out
}

func topCast(in []tmdbCastMember) []*relaxv1.CastMember {
	// TMDB returns cast in credit order; sort by Order ascending to be safe.
	sorted := append([]tmdbCastMember(nil), in...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Order < sorted[j].Order })
	if len(sorted) > castLimit {
		sorted = sorted[:castLimit]
	}
	out := make([]*relaxv1.CastMember, len(sorted))
	for i, c := range sorted {
		out[i] = &relaxv1.CastMember{
			Id:         c.ID,
			Name:       c.Name,
			Character:  c.Character,
			ProfileUrl: profileURL(c.ProfilePath),
		}
	}
	return out
}

func meanRuntime(rt []int32) int32 {
	if len(rt) == 0 {
		return 0
	}
	var sum int32
	for _, v := range rt {
		sum += v
	}
	return sum / int32(len(rt))
}

func mapSlice[T any, R any](in []T, fn func(T) R) []R {
	out := make([]R, len(in))
	for i, v := range in {
		out[i] = fn(v)
	}
	return out
}

func personDetailToProto(d tmdbPersonDetail) *relaxv1.PersonDetail {
	return &relaxv1.PersonDetail{
		Id:                 d.ID,
		Name:               d.Name,
		ProfileUrl:         profileURL(d.ProfilePath),
		Biography:          d.Biography,
		Birthday:           d.Birthday,
		Deathday:           d.Deathday,
		PlaceOfBirth:       d.PlaceOfBirth,
		KnownForDepartment: d.KnownForDepartment,
		Credits:            personCredits(d.CombinedCredits.Cast),
	}
}

// personCredits keeps only movie/tv credits, sorts newest first by release year,
// and skips entries without a release date (un-released / draft rows).
func personCredits(in []tmdbPersonCredit) []*relaxv1.PersonCredit {
	out := make([]*relaxv1.PersonCredit, 0, len(in))
	for _, c := range in {
		var mt relaxv1.MediaType
		var title, date string
		switch c.MediaType {
		case "movie":
			mt = relaxv1.MediaType_MEDIA_TYPE_MOVIE
			title = c.Title
			date = c.ReleaseDate
		case "tv":
			mt = relaxv1.MediaType_MEDIA_TYPE_TV
			title = c.Name
			date = c.FirstAirDate
		default:
			continue
		}
		out = append(out, &relaxv1.PersonCredit{
			TmdbId:      c.ID,
			MediaType:   mt,
			Title:       title,
			PosterUrl:   posterURL(c.PosterPath),
			ReleaseDate: date,
			Character:   c.Character,
			VoteAverage: c.VoteAverage,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		// Empty dates last; otherwise newest first.
		if out[i].ReleaseDate == "" {
			return false
		}
		if out[j].ReleaseDate == "" {
			return true
		}
		return out[i].ReleaseDate > out[j].ReleaseDate
	})
	return out
}
