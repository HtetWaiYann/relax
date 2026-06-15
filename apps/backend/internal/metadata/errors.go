package metadata

import "fmt"

// APIError is returned when TMDB responds with a non-2xx status. The server
// layer maps Status to a Connect error code so we never leak TMDB's raw body.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("tmdb: %d %s", e.Status, e.Message)
}
