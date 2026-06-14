// Package metadata will host the TMDB client used to enrich search results.
// Today it's only an interface stub.
package metadata

// Client looks up movie/TV metadata from an upstream provider (TMDB).
type Client interface {
	// TODO: Search(ctx context.Context, query string) ([]Result, error)
	// TODO: Get(ctx context.Context, id string) (Result, error)
}

type stubClient struct{ apiKey string }

// New constructs a metadata client. apiKey may be empty in development.
func New(apiKey string) Client { return stubClient{apiKey: apiKey} }
