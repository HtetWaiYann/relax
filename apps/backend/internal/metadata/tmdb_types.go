package metadata

// Minimal subset of TMDB v3 response shapes — only the fields we map.

type tmdbMovie struct {
	ID           int32   `json:"id"`
	Title        string  `json:"title"`
	PosterPath   string  `json:"poster_path"`
	BackdropPath string  `json:"backdrop_path"`
	ReleaseDate  string  `json:"release_date"`
	VoteAverage  float64 `json:"vote_average"`
	GenreIDs     []int32 `json:"genre_ids"`
}

type tmdbTV struct {
	ID           int32   `json:"id"`
	Name         string  `json:"name"`
	PosterPath   string  `json:"poster_path"`
	BackdropPath string  `json:"backdrop_path"`
	FirstAirDate string  `json:"first_air_date"`
	VoteAverage  float64 `json:"vote_average"`
	GenreIDs     []int32 `json:"genre_ids"`
}

// /search/multi result rows have a media_type discriminator and a union of
// movie / tv / person fields. We only consume movie + tv rows.
type tmdbMultiResult struct {
	MediaType    string  `json:"media_type"`
	ID           int32   `json:"id"`
	Title        string  `json:"title"`        // movies
	Name         string  `json:"name"`         // tv + person
	PosterPath   string  `json:"poster_path"`
	BackdropPath string  `json:"backdrop_path"`
	ReleaseDate  string  `json:"release_date"`  // movies
	FirstAirDate string  `json:"first_air_date"` // tv
	VoteAverage  float64 `json:"vote_average"`
	GenreIDs     []int32 `json:"genre_ids"`
}

type tmdbPaginated[T any] struct {
	Page         int32 `json:"page"`
	Results      []T   `json:"results"`
	TotalPages   int32 `json:"total_pages"`
	TotalResults int32 `json:"total_results"`
}

type tmdbGenre struct {
	ID   int32  `json:"id"`
	Name string `json:"name"`
}

type tmdbProductionCountry struct {
	ISO  string `json:"iso_3166_1"`
	Name string `json:"name"`
}

type tmdbCastMember struct {
	ID          int32  `json:"id"`
	Name        string `json:"name"`
	Character   string `json:"character"`
	ProfilePath string `json:"profile_path"`
	Order       int32  `json:"order"`
}

type tmdbCredits struct {
	Cast []tmdbCastMember `json:"cast"`
}

type tmdbMovieDetail struct {
	ID                  int32                   `json:"id"`
	Title               string                  `json:"title"`
	PosterPath          string                  `json:"poster_path"`
	BackdropPath        string                  `json:"backdrop_path"`
	ReleaseDate         string                  `json:"release_date"`
	VoteAverage         float64                 `json:"vote_average"`
	Overview            string                  `json:"overview"`
	Runtime             int32                   `json:"runtime"`
	Tagline             string                  `json:"tagline"`
	Status              string                  `json:"status"`
	OriginalLanguage    string                  `json:"original_language"`
	Genres              []tmdbGenre             `json:"genres"`
	ProductionCountries []tmdbProductionCountry `json:"production_countries"`
	Credits             tmdbCredits             `json:"credits"`
	Similar             tmdbPaginated[tmdbMovie] `json:"similar"`
}

type tmdbTVDetail struct {
	ID                  int32                   `json:"id"`
	Name                string                  `json:"name"`
	PosterPath          string                  `json:"poster_path"`
	BackdropPath        string                  `json:"backdrop_path"`
	FirstAirDate        string                  `json:"first_air_date"`
	VoteAverage         float64                 `json:"vote_average"`
	Overview            string                  `json:"overview"`
	EpisodeRunTime      []int32                 `json:"episode_run_time"`
	Tagline             string                  `json:"tagline"`
	Status              string                  `json:"status"`
	OriginalLanguage    string                  `json:"original_language"`
	Genres              []tmdbGenre             `json:"genres"`
	ProductionCountries []tmdbProductionCountry `json:"production_countries"`
	Credits             tmdbCredits             `json:"credits"`
	Similar             tmdbPaginated[tmdbTV]   `json:"similar"`
}

type tmdbErrorBody struct {
	StatusMessage string `json:"status_message"`
	StatusCode    int    `json:"status_code"`
}

type tmdbPersonCredit struct {
	ID           int32   `json:"id"`
	MediaType    string  `json:"media_type"` // present on combined_credits rows
	Title        string  `json:"title"`
	Name         string  `json:"name"`
	PosterPath   string  `json:"poster_path"`
	ReleaseDate  string  `json:"release_date"`
	FirstAirDate string  `json:"first_air_date"`
	Character    string  `json:"character"`
	VoteAverage  float64 `json:"vote_average"`
}

type tmdbCombinedCredits struct {
	Cast []tmdbPersonCredit `json:"cast"`
}

type tmdbPersonDetail struct {
	ID                 int32               `json:"id"`
	Name               string              `json:"name"`
	ProfilePath        string              `json:"profile_path"`
	Biography          string              `json:"biography"`
	Birthday           string              `json:"birthday"`
	Deathday           string              `json:"deathday"`
	PlaceOfBirth       string              `json:"place_of_birth"`
	KnownForDepartment string              `json:"known_for_department"`
	CombinedCredits    tmdbCombinedCredits `json:"combined_credits"`
}
