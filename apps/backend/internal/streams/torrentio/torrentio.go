// Package torrentio talks to the public Torrentio Stremio addon
// (https://torrentio.strem.fun) and maps its JSON to StreamSource.
package torrentio

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	relaxv1 "relax/gen/relax/v1"
)

const (
	defaultBaseURL = "https://torrentio.strem.fun"
	httpTimeout    = 8 * time.Second
)

// Provider is a streams.Provider backed by Torrentio.
type Provider struct {
	baseURL string
	http    *http.Client
	source  string
}

func New(baseURL string) *Provider {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Provider{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: httpTimeout},
		source:  "Torrentio",
	}
}

type rawStream struct {
	Name           string `json:"name"`
	Title          string `json:"title"`
	InfoHash       string `json:"infoHash"`
	FileIdx        *int32 `json:"fileIdx,omitempty"`
	BehaviorHints  struct {
		VideoSize int64  `json:"videoSize"`
		Filename  string `json:"filename"`
	} `json:"behaviorHints"`
}

type rawResponse struct {
	Streams []rawStream `json:"streams"`
}

// GetStreams hits /stream/{type}/{imdb}[:{s}:{e}].json on the Torrentio addon.
// On HTTP / parse failure it returns (empty, nil) — RPC stays healthy and just
// shows "No streams found" in the renderer.
func (p *Provider) GetStreams(
	ctx context.Context,
	imdbID string,
	mediaType relaxv1.MediaType,
	season, episode *int32,
) ([]*relaxv1.StreamSource, error) {
	if imdbID == "" {
		return nil, fmt.Errorf("imdb_id is required")
	}

	var path string
	switch mediaType {
	case relaxv1.MediaType_MEDIA_TYPE_MOVIE:
		path = fmt.Sprintf("/stream/movie/%s.json", imdbID)
	case relaxv1.MediaType_MEDIA_TYPE_TV:
		if season == nil || episode == nil {
			return nil, fmt.Errorf("season and episode are required for TV")
		}
		path = fmt.Sprintf("/stream/series/%s:%d:%d.json", imdbID, *season, *episode)
	default:
		return nil, fmt.Errorf("unsupported media type: %v", mediaType)
	}

	url := p.baseURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	// ponytail: Torrentio's WAF 403s the default Go User-Agent; pose as a browser.
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")
	slog.Debug("torrentio request", "url", url)
	resp, err := p.http.Do(req)
	if err != nil {
		slog.Warn("torrentio http error", "url", url, "err", err)
		return []*relaxv1.StreamSource{}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		slog.Warn("torrentio non-2xx", "url", url, "status", resp.StatusCode)
		return []*relaxv1.StreamSource{}, nil
	}

	var body rawResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		slog.Warn("torrentio decode error", "url", url, "err", err)
		return []*relaxv1.StreamSource{}, nil
	}
	slog.Info("torrentio streams", "url", url, "count", len(body.Streams))

	out := make([]*relaxv1.StreamSource, 0, len(body.Streams))
	for _, s := range body.Streams {
		if s.InfoHash == "" {
			continue
		}
		out = append(out, p.toSource(s))
	}
	sort.SliceStable(out, func(i, j int) bool {
		qi, qj := qualityRank(out[i].GetQuality()), qualityRank(out[j].GetQuality())
		if qi != qj {
			return qi > qj
		}
		return out[i].GetSeeders() > out[j].GetSeeders()
	})
	return out, nil
}

func (p *Provider) toSource(r rawStream) *relaxv1.StreamSource {
	title := strings.TrimSpace(r.BehaviorHints.Filename)
	if title == "" {
		// Torrentio packs "Release name\n👤 seeders 💾 size ⚙ tracker" in title.
		title = firstLine(r.Title)
	}
	size := r.BehaviorHints.VideoSize
	if size == 0 {
		size = parseSize(r.Title)
	}
	return &relaxv1.StreamSource{
		Title:      title,
		Quality:    parseQuality(r.Title + " " + r.BehaviorHints.Filename),
		SizeBytes:  size,
		Seeders:    parseSeeders(r.Title),
		InfoHash:   r.InfoHash,
		FileIdx:    derefInt32(r.FileIdx),
		SourceName: sourceFromName(r.Name, p.source),
	}
}

var (
	qualityRe = regexp.MustCompile(`(?i)\b(2160p|4k|1080p|720p|480p|360p)\b`)
	seedersRe = regexp.MustCompile(`👤\s*(\d+)`)
	sizeRe    = regexp.MustCompile(`(?i)💾\s*([\d.]+)\s*(GB|MB)`)
	// "Torrentio\nYTS" → "YTS"
	nameTagRe = regexp.MustCompile(`(?i)torrentio\W*`)
)

func parseQuality(s string) string {
	m := qualityRe.FindString(s)
	switch strings.ToLower(m) {
	case "2160p", "4k":
		return "4K"
	case "":
		return ""
	default:
		return strings.ToLower(m)
	}
}

func parseSeeders(title string) int32 {
	m := seedersRe.FindStringSubmatch(title)
	if len(m) < 2 {
		return 0
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		return 0
	}
	return int32(n)
}

func parseSize(title string) int64 {
	m := sizeRe.FindStringSubmatch(title)
	if len(m) < 3 {
		return 0
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0
	}
	switch strings.ToUpper(m[2]) {
	case "GB":
		return int64(v * 1024 * 1024 * 1024)
	case "MB":
		return int64(v * 1024 * 1024)
	}
	return 0
}

// sourceFromName turns Torrentio's "Torrentio\nYTS" into "Torrentio - YTS"
// when a tracker tag is present, else falls back to the provider name.
func sourceFromName(name, fallback string) string {
	parts := strings.Split(strings.TrimSpace(name), "\n")
	if len(parts) >= 2 {
		tag := strings.TrimSpace(parts[1])
		if tag != "" {
			return fallback + " - " + tag
		}
	}
	cleaned := strings.TrimSpace(nameTagRe.ReplaceAllString(name, ""))
	if cleaned != "" && cleaned != name {
		return fallback + " - " + cleaned
	}
	return fallback
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return strings.TrimSpace(s)
}

func derefInt32(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}

func qualityRank(q string) int {
	switch strings.ToLower(q) {
	case "4k":
		return 4
	case "1080p":
		return 3
	case "720p":
		return 2
	case "480p":
		return 1
	default:
		return 0
	}
}
