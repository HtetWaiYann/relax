package torrentio

import "testing"

func TestParseTitleHeuristics(t *testing.T) {
	title := "The Movie 2024 1080p BluRay x264\n👤 1840 💾 4.1 GB ⚙ YTS"
	if got := parseQuality(title); got != "1080p" {
		t.Errorf("quality: want 1080p got %q", got)
	}
	if got := parseSeeders(title); got != 1840 {
		t.Errorf("seeders: want 1840 got %d", got)
	}
	if got := parseSize(title); got < 4_000_000_000 || got > 4_500_000_000 {
		t.Errorf("size: out of range, got %d", got)
	}
	if got := parseQuality("Movie 2160p HDR"); got != "4K" {
		t.Errorf("quality 2160p: want 4K got %q", got)
	}
	if got := sourceFromName("Torrentio\nYTS", "Torrentio"); got != "Torrentio - YTS" {
		t.Errorf("source: got %q", got)
	}
}
