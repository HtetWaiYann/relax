package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestListByMedia(t *testing.T) {
	store, err := New(filepath.Join(t.TempDir(), "test.db"), 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx := context.Background()

	base := time.Now()
	rows := []WatchProgress{
		// Series 42: E1 watched, E2 in-progress (newer).
		{MediaID: "42", MediaType: 2, Season: 1, Episode: 1, PositionSeconds: 100, DurationSeconds: 100, LastWatchedAt: base, MagnetURI: "magnet:?xt=1"},
		{MediaID: "42", MediaType: 2, Season: 1, Episode: 2, PositionSeconds: 30, DurationSeconds: 100, LastWatchedAt: base.Add(time.Minute), MagnetURI: "magnet:?xt=2"},
		// Different series — must not leak in.
		{MediaID: "99", MediaType: 2, Season: 1, Episode: 1, PositionSeconds: 10, DurationSeconds: 100, LastWatchedAt: base, MagnetURI: "magnet:?xt=3"},
	}
	for _, r := range rows {
		if err := store.Upsert(ctx, r); err != nil {
			t.Fatalf("Upsert: %v", err)
		}
	}

	got, err := store.ListByMedia(ctx, "42", 2)
	if err != nil {
		t.Fatalf("ListByMedia: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 rows for media 42, got %d", len(got))
	}
	// Newest (in-progress E2) first, and both watched + in-progress are included.
	if got[0].Episode != 2 || got[1].Episode != 1 {
		t.Fatalf("want order E2,E1 by last_watched_at desc, got E%d,E%d", got[0].Episode, got[1].Episode)
	}
}
