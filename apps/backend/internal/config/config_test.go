package config

import (
	"log/slog"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("LOG_LEVEL", "")
	t.Setenv("ALLOWED_ORIGIN", "")
	t.Setenv("APP_ENV", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port: want 8080, got %d", cfg.Port)
	}
	if cfg.DatabaseURL != "./relax.db" {
		t.Errorf("DatabaseURL: want ./relax.db, got %q", cfg.DatabaseURL)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel: want info, got %q", cfg.LogLevel)
	}
	if cfg.AllowedOrigin != "http://localhost:5173" {
		t.Errorf("AllowedOrigin: want http://localhost:5173, got %q", cfg.AllowedOrigin)
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("APP_ENV", "production")
	t.Setenv("LOG_LEVEL", "debug")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != 9090 {
		t.Errorf("Port: want 9090, got %d", cfg.Port)
	}
	if !cfg.IsProduction() {
		t.Error("IsProduction: want true")
	}
	if cfg.SlogLevel() != slog.LevelDebug {
		t.Errorf("SlogLevel: want Debug, got %v", cfg.SlogLevel())
	}
}

func TestSlogLevelUnknownFallsBackToInfo(t *testing.T) {
	c := Config{LogLevel: "nonsense"}
	if c.SlogLevel() != slog.LevelInfo {
		t.Errorf("want Info, got %v", c.SlogLevel())
	}
}
