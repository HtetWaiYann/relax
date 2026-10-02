package config

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Port                int    `env:"PORT" envDefault:"8080"`
	TMDBAPIKey          string `env:"TMDB_API_KEY"`
	DatabaseURL         string `env:"DATABASE_URL" envDefault:"./relax.db"`
	LogLevel            string `env:"LOG_LEVEL" envDefault:"info"`
	AllowedOrigin       string `env:"ALLOWED_ORIGIN" envDefault:"http://localhost:5173"`
	AppEnv              string `env:"APP_ENV" envDefault:"development"`
	TorrentioBaseURL    string `env:"TORRENTIO_BASE_URL" envDefault:"https://torrentio.strem.fun"`
	OpenSubtitlesAPIKey string `env:"OPENSUBTITLES_API_KEY"`
	WyzieAPIKey         string `env:"WYZIE_API_KEY"`
	SubtitleCacheDir    string `env:"SUBTITLE_CACHE_DIR" envDefault:"./subtitle_cache"`
	FootballDataAPIKey  string `env:"FOOTBALL_DATA_API_KEY"`
	// SportsCompetitions is a comma-separated list of football-data.org
	// competition codes (PL = Premier League, PD = La Liga).
	SportsCompetitions string `env:"SPORTS_COMPETITIONS" envDefault:"PL,PD"`
	// SportsAddonURL is a Stremio-protocol addon base (or manifest.json) URL
	// used to find live streams for a match. Empty disables streams.
	SportsAddonURL string `env:"SPORTS_ADDON_URL"`
	// SportsDebugMatch ("Home vs Away") injects a fake live fixture into
	// today's list for testing the addon. Leave empty normally.
	SportsDebugMatch string `env:"SPORTS_DEBUG_MATCH"`
	// HistoryTTLDays caps watch_progress retention. 0 disables the startup
	// cleanup; otherwise rows with last_watched_at older than this many days
	// are deleted at backend init.
	HistoryTTLDays int `env:"HISTORY_TTL_DAYS" envDefault:"90"`
	// SubtitleCacheTTLDays caps cached .vtt retention. 0 disables.
	SubtitleCacheTTLDays int `env:"SUBTITLE_CACHE_TTL_DAYS" envDefault:"30"`
}

// Load reads .env (if present) and overlays os.Environ() into a Config.
func Load() (Config, error) {
	if _, err := os.Stat(".env"); err == nil {
		_ = godotenv.Load()
	}
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return Config{}, fmt.Errorf("parse env: %w", err)
	}
	return cfg, nil
}

func (c Config) IsProduction() bool {
	return strings.EqualFold(c.AppEnv, "production")
}

// SlogLevel maps LOG_LEVEL to slog.Level (info on unknown).
func (c Config) SlogLevel() slog.Level {
	switch strings.ToLower(c.LogLevel) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
