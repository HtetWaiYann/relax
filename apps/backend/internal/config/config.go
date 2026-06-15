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
	Port             int    `env:"PORT" envDefault:"8080"`
	TMDBAPIKey       string `env:"TMDB_API_KEY"`
	DatabaseURL      string `env:"DATABASE_URL" envDefault:"./relax.db"`
	LogLevel         string `env:"LOG_LEVEL" envDefault:"info"`
	AllowedOrigin    string `env:"ALLOWED_ORIGIN" envDefault:"http://localhost:5173"`
	AppEnv           string `env:"APP_ENV" envDefault:"development"`
	TorrentioBaseURL string `env:"TORRENTIO_BASE_URL" envDefault:"https://torrentio.strem.fun"`
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
