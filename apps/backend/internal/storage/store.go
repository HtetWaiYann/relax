// Package storage persists local watch history to SQLite (pure-Go driver,
// no CGO). The DB lives at the configured DSN — typically inside Electron's
// userData dir so it shares lifecycle with the desktop app.
package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// WatchProgress mirrors the proto shape; kept here so the storage layer
// doesn't import generated code (avoids a circular import with server).
type WatchProgress struct {
	MediaID         string
	MediaType       int32
	Title           string
	PosterURL       string
	Season          int32
	Episode         int32
	PositionSeconds float64
	DurationSeconds float64
	LastWatchedAt   time.Time
	InfoHash        string
	FileIdx         int32
	MagnetURI       string
}

// FinishedRatio: once watched past this fraction of duration, the entry is
// hidden from Continue Watching. 97% covers credits / outro skips.
const FinishedRatio = 0.97

// Store is the persistence contract for RELAX.
type Store interface {
	Upsert(ctx context.Context, p WatchProgress) error
	Get(ctx context.Context, mediaID string, mediaType, season, episode int32) (WatchProgress, bool, error)
	History(ctx context.Context, limit, offset int) ([]WatchProgress, int, error)
	Delete(ctx context.Context, mediaID string, mediaType, season, episode int32) error
	Clear(ctx context.Context) error
	Close() error
}

type sqliteStore struct {
	db *sql.DB
}

// New opens the SQLite DB at dsn and runs migrations. dsn is a plain path
// like "./relax.db"; the driver name "sqlite" comes from modernc.org/sqlite.
func New(dsn string) (Store, error) {
	if dsn == "" {
		return nil, errors.New("storage: empty dsn")
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // ponytail: serialize writes; single-user desktop app
	if err := migrate(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &sqliteStore{db: db}, nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS watch_progress (
			media_id          TEXT    NOT NULL,
			media_type        INTEGER NOT NULL,
			season            INTEGER NOT NULL DEFAULT 0,
			episode           INTEGER NOT NULL DEFAULT 0,
			title             TEXT    NOT NULL DEFAULT '',
			poster_url        TEXT    NOT NULL DEFAULT '',
			position_seconds  REAL    NOT NULL DEFAULT 0,
			duration_seconds  REAL    NOT NULL DEFAULT 0,
			last_watched_at   INTEGER NOT NULL DEFAULT 0,
			info_hash         TEXT    NOT NULL DEFAULT '',
			file_idx          INTEGER NOT NULL DEFAULT 0,
			magnet_uri        TEXT    NOT NULL DEFAULT '',
			PRIMARY KEY (media_id, media_type, season, episode)
		);
		CREATE INDEX IF NOT EXISTS idx_watch_progress_last_watched
			ON watch_progress (last_watched_at DESC);
	`)
	return err
}

func (s *sqliteStore) Close() error { return s.db.Close() }

func (s *sqliteStore) Upsert(ctx context.Context, p WatchProgress) error {
	if p.MediaID == "" {
		return errors.New("media_id required")
	}
	if p.MagnetURI == "" {
		return errors.New("magnet_uri required")
	}
	t := p.LastWatchedAt
	if t.IsZero() {
		t = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO watch_progress
			(media_id, media_type, season, episode, title, poster_url,
			 position_seconds, duration_seconds, last_watched_at,
			 info_hash, file_idx, magnet_uri)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(media_id, media_type, season, episode) DO UPDATE SET
			title = excluded.title,
			poster_url = excluded.poster_url,
			position_seconds = excluded.position_seconds,
			duration_seconds = excluded.duration_seconds,
			last_watched_at = excluded.last_watched_at,
			info_hash = excluded.info_hash,
			file_idx = excluded.file_idx,
			magnet_uri = excluded.magnet_uri
	`, p.MediaID, p.MediaType, p.Season, p.Episode, p.Title, p.PosterURL,
		p.PositionSeconds, p.DurationSeconds, t.UnixMilli(),
		p.InfoHash, p.FileIdx, p.MagnetURI)
	return err
}

func (s *sqliteStore) Get(ctx context.Context, mediaID string, mediaType, season, episode int32) (WatchProgress, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT media_id, media_type, season, episode, title, poster_url,
		       position_seconds, duration_seconds, last_watched_at,
		       info_hash, file_idx, magnet_uri
		FROM watch_progress
		WHERE media_id = ? AND media_type = ? AND season = ? AND episode = ?
	`, mediaID, mediaType, season, episode)
	p, err := scanRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return WatchProgress{}, false, nil
	}
	if err != nil {
		return WatchProgress{}, false, err
	}
	return p, true, nil
}

func (s *sqliteStore) History(ctx context.Context, limit, offset int) ([]WatchProgress, int, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	// ponytail: filter "finished" rows in SQL via the 97% ratio. Saves a Go-side pass.
	rows, err := s.db.QueryContext(ctx, `
		SELECT media_id, media_type, season, episode, title, poster_url,
		       position_seconds, duration_seconds, last_watched_at,
		       info_hash, file_idx, magnet_uri
		FROM watch_progress
		WHERE magnet_uri != ''
		  AND duration_seconds > 0
		  AND (position_seconds / duration_seconds) < ?
		ORDER BY last_watched_at DESC
		LIMIT ? OFFSET ?
	`, FinishedRatio, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]WatchProgress, 0, limit)
	for rows.Next() {
		p, err := scanRow(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	var total int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM watch_progress
		WHERE magnet_uri != ''
		  AND duration_seconds > 0
		  AND (position_seconds / duration_seconds) < ?
	`, FinishedRatio).Scan(&total); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (s *sqliteStore) Delete(ctx context.Context, mediaID string, mediaType, season, episode int32) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM watch_progress
		WHERE media_id = ? AND media_type = ? AND season = ? AND episode = ?
	`, mediaID, mediaType, season, episode)
	return err
}

func (s *sqliteStore) Clear(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM watch_progress`)
	return err
}

// scanner shared by Get + History (works for *sql.Row and *sql.Rows).
type scanner interface {
	Scan(...any) error
}

func scanRow(s scanner) (WatchProgress, error) {
	var p WatchProgress
	var ms int64
	if err := s.Scan(
		&p.MediaID, &p.MediaType, &p.Season, &p.Episode,
		&p.Title, &p.PosterURL,
		&p.PositionSeconds, &p.DurationSeconds, &ms,
		&p.InfoHash, &p.FileIdx, &p.MagnetURI,
	); err != nil {
		return WatchProgress{}, err
	}
	p.LastWatchedAt = time.UnixMilli(ms).UTC()
	return p, nil
}
