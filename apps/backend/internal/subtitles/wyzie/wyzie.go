// Package wyzie implements the subtitles.Provider interface against
// sub.wyzie.io — a public aggregator that fronts subdl, OpenSubtitles, and
// other sources behind a single search endpoint. Requires a free API key
// (https://store.wyzie.io/redeem).
package wyzie

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	relaxv1 "relax/gen/relax/v1"
	"relax/internal/subtitles"
)

const (
	providerName    = "wyzie"
	defaultEndpoint = "https://sub.wyzie.io"
	userAgent       = "RELAX/1.0"
	httpTimeout     = 8 * time.Second
)

type Client struct {
	endpoint string
	apiKey   string
	http     *http.Client
}

func New(apiKey string) *Client {
	return &Client{
		endpoint: defaultEndpoint,
		apiKey:   apiKey,
		http:     &http.Client{Timeout: httpTimeout},
	}
}

func (c *Client) Name() string { return providerName }

// Shape per wyzie-lib SubtitleData. We only decode the fields we actually use.
type wyzieResult struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	Format   string `json:"format"`
	Display  string `json:"display"`
	Language string `json:"language"`
}

func (c *Client) Search(ctx context.Context, imdbID string, season, episode int32) ([]*relaxv1.SubtitleTrack, error) {
	if !strings.HasPrefix(imdbID, "tt") {
		return nil, nil
	}

	q := url.Values{}
	q.Set("id", imdbID)
	q.Set("language", "en")
	q.Set("format", "srt")
	q.Set("key", c.apiKey)
	if season > 0 {
		q.Set("season", fmt.Sprintf("%d", season))
		q.Set("episode", fmt.Sprintf("%d", episode))
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"/search?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("wyzie search: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, subtitles.ErrQuotaExceeded
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wyzie search: status %d", resp.StatusCode)
	}

	var results []wyzieResult
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&results); err != nil {
		return nil, fmt.Errorf("wyzie search decode: %w", err)
	}

	tracks := make([]*relaxv1.SubtitleTrack, 0, len(results))
	for _, r := range results {
		if r.URL == "" {
			continue
		}
		label := r.Display
		if label == "" {
			label = strings.ToUpper(r.Language)
		}
		tracks = append(tracks, &relaxv1.SubtitleTrack{
			Language:   r.Language,
			Label:      label,
			Format:     r.Format,
			SourceName: "Wyzie",
			// The URL is the only identifier we need to download — encode
			// the format alongside so Download knows whether to convert.
			TrackReference: subtitles.PrefixRef(providerName, r.Format+"|"+r.URL),
		})
	}
	return tracks, nil
}

func (c *Client) Download(ctx context.Context, ref string) (string, error) {
	format, dlURL, ok := strings.Cut(ref, "|")
	if !ok {
		// Legacy refs without an explicit format prefix — treat as srt.
		format, dlURL = "srt", ref
	}
	if !strings.HasPrefix(dlURL, "http") {
		return "", fmt.Errorf("wyzie: ref must contain a URL, got %q", ref)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dlURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("wyzie download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("wyzie download: status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", fmt.Errorf("wyzie read: %w", err)
	}
	text := string(body)
	if strings.EqualFold(format, "vtt") {
		return text, nil
	}
	// ponytail: ASS/SSA arrive rarely — treat as SRT (basic strip is good enough; upgrade if users report missing styling).
	return srtToVTT(text), nil
}

var commaTimecode = regexp.MustCompile(`(\d{2}:\d{2}:\d{2}),(\d{3})`)

func srtToVTT(srt string) string {
	cleaned := strings.ReplaceAll(srt, "\r\n", "\n")
	cleaned = strings.ReplaceAll(cleaned, "\r", "\n")
	cleaned = strings.TrimPrefix(cleaned, "\xef\xbb\xbf")
	converted := commaTimecode.ReplaceAllString(cleaned, "$1.$2")
	return "WEBVTT\n\n" + converted
}
