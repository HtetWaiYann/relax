// Package subtitles defines the Provider interface every subtitle source
// (OpenSubtitles, YIFYSubs, future ones) implements, plus shared helpers for
// reference encoding and disk caching.
package subtitles

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"strings"

	relaxv1 "relax/gen/relax/v1"
)

// ErrQuotaExceeded signals the provider's per-period download budget is
// exhausted. The Connect handler translates this to ResourceExhausted so the
// renderer can show a user-facing "limit reached" message.
var ErrQuotaExceeded = errors.New("subtitles: download quota exceeded")

type Provider interface {
	// Name returns a short stable identifier ("opensubtitles", "yifysubs")
	// used both as the SubtitleTrack.SourceName the renderer groups by and
	// as the prefix in TrackReference for download dispatch.
	Name() string

	// Search returns tracks for the given IMDB id. season and episode are
	// 0 for movies. Providers that only handle movies return an empty slice
	// (not an error) when episode/season are set.
	Search(ctx context.Context, imdbID string, season, episode int32) ([]*relaxv1.SubtitleTrack, error)

	// Download fetches the subtitle for the provider-specific ref (the part
	// after "{name}:" in the public TrackReference) and returns WebVTT.
	Download(ctx context.Context, ref string) (string, error)
}

// PrefixRef returns "{provider}:{ref}" for the public TrackReference.
func PrefixRef(name, ref string) string { return name + ":" + ref }

// SplitRef parses "{provider}:{ref}". Returns ok=false if the input has no
// recognized prefix; callers can treat unprefixed refs as legacy if needed.
func SplitRef(s string) (name, ref string, ok bool) {
	i := strings.Index(s, ":")
	if i <= 0 || i == len(s)-1 {
		return "", s, false
	}
	return s[:i], s[i+1:], true
}

// CacheKey returns a stable filesystem-safe filename for a track reference.
// SHA-1 is fine here — only used for collision avoidance, not security.
func CacheKey(ref string) string {
	h := sha1.Sum([]byte(ref))
	return hex.EncodeToString(h[:])
}
