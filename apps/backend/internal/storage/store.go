// Package storage persists local watch history to SQLite (pure-Go driver,
// no CGO). The DB lives at the configured DSN — typically inside Electron's
// userData dir so it shares lifecycle with the desktop app.
package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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

// WatchlistItem mirrors the proto shape. Genres are stored as a JSON array
// in a TEXT column to keep the schema flat — same trade-off as the watch
// history table (single-user desktop app, no need for a join).
type WatchlistItem struct {
	MediaID     string
	MediaType   int32
	Title       string
	PosterURL   string
	BackdropURL string
	Overview    string
	VoteAverage float64
	ReleaseYear int32
	Genres      []string
	AddedAt     time.Time
}

// WatchlistQuery captures the dynamic filter/sort options for GetWatchlist.
type WatchlistQuery struct {
	SortBy    string // "added_at" | "title" | "rating"
	Order     string // "asc" | "desc"
	MediaType int32  // 0 = all, otherwise filter
	Limit     int
	Offset    int
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

	WatchlistAdd(ctx context.Context, item WatchlistItem) error
	WatchlistRemove(ctx context.Context, mediaID string, mediaType int32) error
	WatchlistList(ctx context.Context, q WatchlistQuery) ([]WatchlistItem, int, error)
	WatchlistHas(ctx context.Context, mediaID string, mediaType int32) (bool, error)
	WatchlistClear(ctx context.Context) error

	Close() error
}

type sqliteStore struct {
	db *sql.DB
}

// New opens the SQLite DB at dsn and runs migrations. dsn is a plain path
// like "./relax.db"; the driver name "sqlite" comes from modernc.org/sqlite.
// historyTTLDays > 0 enables a startup cleanup of watch_progress rows older
// than the threshold; pass 0 to disable (useful for tests).
func New(dsn string, historyTTLDays int) (Store, error) {
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
	startupCleanup(db, historyTTLDays)
	return &sqliteStore{db: db}, nil
}

// startupCleanup drops rows with malformed magnets and (if enabled) ages out
// old watch_progress. Logged best-effort — startup never fails on a cleanup
// error since the user can still read/write afterwards.
func startupCleanup(db *sql.DB, historyTTLDays int) {
	res, err := db.Exec(`
		DELETE FROM watch_progress
		WHERE magnet_uri = '' OR magnet_uri NOT LIKE 'magnet:?%'
	`)
	if err != nil {
		slog.Warn("startup: cleanup invalid magnets failed", "err", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		slog.Info("startup: removed watch_progress rows with invalid magnet", "count", n)
	}
	if historyTTLDays > 0 {
		cutoff := time.Now().AddDate(0, 0, -historyTTLDays).UnixMilli()
		res, err := db.Exec(`DELETE FROM watch_progress WHERE last_watched_at < ?`, cutoff)
		if err != nil {
			slog.Warn("startup: history TTL cleanup failed", "err", err)
		} else if n, _ := res.RowsAffected(); n > 0 {
			slog.Info("startup: aged out watch_progress rows", "count", n, "ttl_days", historyTTLDays)
		}
	}
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

		CREATE TABLE IF NOT EXISTS watchlist (
			media_id      TEXT    NOT NULL,
			media_type    INTEGER NOT NULL,
			title         TEXT    NOT NULL DEFAULT '',
			poster_url    TEXT    NOT NULL DEFAULT '',
			backdrop_url  TEXT    NOT NULL DEFAULT '',
			overview      TEXT    NOT NULL DEFAULT '',
			vote_average  REAL    NOT NULL DEFAULT 0,
			release_year  INTEGER NOT NULL DEFAULT 0,
			genres        TEXT    NOT NULL DEFAULT '[]',
			added_at      INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (media_id, media_type)
		);
		CREATE INDEX IF NOT EXISTS idx_watchlist_added_at
			ON watchlist (added_at DESC);
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

// ponytail: column allowlist for ORDER BY — never interpolate user input directly.
var watchlistSortColumn = map[string]string{
	"added_at": "added_at",
	"title":    "title COLLATE NOCASE",
	"rating":   "vote_average",
}

func (s *sqliteStore) WatchlistAdd(ctx context.Context, item WatchlistItem) error {
	if item.MediaID == "" {
		return errors.New("media_id required")
	}
	t := item.AddedAt
	if t.IsZero() {
		t = time.Now().UTC()
	}
	genres, err := json.Marshal(item.Genres)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO watchlist
			(media_id, media_type, title, poster_url, backdrop_url, overview,
			 vote_average, release_year, genres, added_at)
		VALUES (?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(media_id, media_type) DO UPDATE SET
			title = excluded.title,
			poster_url = excluded.poster_url,
			backdrop_url = excluded.backdrop_url,
			overview = excluded.overview,
			vote_average = excluded.vote_average,
			release_year = excluded.release_year,
			genres = excluded.genres,
			added_at = excluded.added_at
	`, item.MediaID, item.MediaType, item.Title, item.PosterURL, item.BackdropURL,
		item.Overview, item.VoteAverage, item.ReleaseYear, string(genres), t.UnixMilli())
	return err
}

func (s *sqliteStore) WatchlistRemove(ctx context.Context, mediaID string, mediaType int32) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM watchlist WHERE media_id = ? AND media_type = ?`,
		mediaID, mediaType)
	return err
}

func (s *sqliteStore) WatchlistList(ctx context.Context, q WatchlistQuery) ([]WatchlistItem, int, error) {
	col, ok := watchlistSortColumn[q.SortBy]
	if !ok {
		col = "added_at"
	}
	dir := "DESC"
	if q.Order == "asc" {
		dir = "ASC"
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 50
	}
	offset := q.Offset
	if offset < 0 {
		offset = 0
	}

	where := ""
	args := []any{}
	if q.MediaType > 0 {
		where = "WHERE media_type = ?"
		args = append(args, q.MediaType)
	}

	listSQL := fmt.Sprintf(`
		SELECT media_id, media_type, title, poster_url, backdrop_url, overview,
		       vote_average, release_year, genres, added_at
		FROM watchlist
		%s
		ORDER BY %s %s
		LIMIT ? OFFSET ?
	`, where, col, dir)
	listArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.QueryContext(ctx, listSQL, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]WatchlistItem, 0, limit)
	for rows.Next() {
		var it WatchlistItem
		var ms int64
		var genres string
		if err := rows.Scan(
			&it.MediaID, &it.MediaType, &it.Title, &it.PosterURL, &it.BackdropURL,
			&it.Overview, &it.VoteAverage, &it.ReleaseYear, &genres, &ms,
		); err != nil {
			return nil, 0, err
		}
		if genres != "" {
			_ = json.Unmarshal([]byte(genres), &it.Genres)
		}
		it.AddedAt = time.UnixMilli(ms).UTC()
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	var total int
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM watchlist %s", where)
	if err := s.db.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (s *sqliteStore) WatchlistHas(ctx context.Context, mediaID string, mediaType int32) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM watchlist WHERE media_id = ? AND media_type = ?`,
		mediaID, mediaType,
	).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (s *sqliteStore) WatchlistClear(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM watchlist`)
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
