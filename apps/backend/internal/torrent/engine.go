// Package torrent will host the real BitTorrent engine (likely anacrolix/torrent).
// Today it's only an interface stub so the rest of the backend can compile.
package torrent

// Engine is the contract the rest of the backend depends on for torrent ops.
type Engine interface {
	// TODO: Add(magnet string) (id string, err error)
	// TODO: Remove(id string) error
	// TODO: Progress(id string) (Progress, error)
}

type noopEngine struct{}

// New returns an Engine implementation. For now it's a no-op; the real one
// will be wired in once anacrolix/torrent (or equivalent) is integrated.
func New() Engine { return noopEngine{} }
