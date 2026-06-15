// Package streams defines a tiny Provider plugin surface for torrent stream
// sources and ships a Torrentio implementation. Additional providers
// (AIOStreams, self-hosted Stremio addons) can implement the same interface
// without touching the RPC handler.
package streams

import (
	"context"

	relaxv1 "relax/gen/relax/v1"
)

// Provider returns torrent stream sources for an IMDB id. Movies pass nil
// season/episode; series pass both.
type Provider interface {
	GetStreams(ctx context.Context, imdbID string, mediaType relaxv1.MediaType, season, episode *int32) ([]*relaxv1.StreamSource, error)
}
