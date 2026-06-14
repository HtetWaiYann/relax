// Package storage will host the persistence layer (SQLite) for watch progress
// and the library. Today it's only an interface stub.
package storage

// Store is the persistence contract for RELAX.
type Store interface {
	// TODO: SaveWatchProgress(ctx, p) error
	// TODO: GetWatchProgress(ctx, mediaID) (WatchProgress, error)
	Close() error
}

type memoryStore struct{}

// New returns an in-memory placeholder store keyed off the configured DSN.
func New(_ string) (Store, error) { return memoryStore{}, nil }

func (memoryStore) Close() error { return nil }
