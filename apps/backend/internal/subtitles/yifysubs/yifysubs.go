// Package yifysubs implements the subtitles.Provider interface against
// yifysubtitles.ch — a public, account-free movie subtitle source.
//
// Implementation: a small HTML scraper, not the colly-based community
// library. We need ctx.Done() cancellation and a small dep tree, which the
// library lacks. The page layout this scrapes has been stable for years; if
// it ever shifts, swap to golang.org/x/net/html DOM traversal.
package yifysubs

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	relaxv1 "relax/gen/relax/v1"
	"relax/internal/subtitles"
)

const (
	defaultEndpoint = "https://yifysubtitles.ch"
	userAgent       = "Mozilla/5.0 (compatible; RELAX/1.0; +https://github.com/relax)"
	httpTimeout     = 5 * time.Second
)

type Client struct {
	endpoint string
	http     *http.Client
}

func New() *Client {
	return &Client{
		endpoint: defaultEndpoint,
		http:     &http.Client{Timeout: httpTimeout},
	}
}

func (c *Client) Name() string { return "yifysubs" }

// Each <tr> on the search results page roughly looks like:
//
//	<tr ...>
//	  <td class="rating-cell">…</td>
//	  <td class="flag-cell"><span class="sub-lang">English</span></td>
//	  <td><a href="/subtitles/the-matrix-yify-12345">…</a></td>
//	  ...
//	</tr>
//
// We don't try to parse the whole DOM — three small regexes are enough and
// fail closed (no match → row skipped) if the page changes.
var (
	rowRe  = regexp.MustCompile(`(?s)<tr[^>]*>(.*?)</tr>`)
	langRe = regexp.MustCompile(`<span class="sub-lang">([^<]+)</span>`)
	linkRe = regexp.MustCompile(`<a[^>]+href="(/subtitles/[^"]+)"`)
)

func (c *Client) Search(ctx context.Context, imdbID string, season, episode int32) ([]*relaxv1.SubtitleTrack, error) {
	// YIFYSubs is movie-only — TV episodes get a clean skip, not an error.
	if season != 0 || episode != 0 {
		return nil, nil
	}
	if !strings.HasPrefix(imdbID, "tt") {
		return nil, nil
	}

	url := c.endpoint + "/movie-imdb/" + imdbID
	body, err := c.fetch(ctx, url, "")
	if err != nil {
		return nil, err
	}

	tracks := make([]*relaxv1.SubtitleTrack, 0, 8)
	seen := map[string]bool{}
	for _, row := range rowRe.FindAllSubmatch(body, -1) {
		langMatch := langRe.FindSubmatch(row[1])
		linkMatch := linkRe.FindSubmatch(row[1])
		if langMatch == nil || linkMatch == nil {
			continue
		}
		lang := strings.ToLower(strings.TrimSpace(string(langMatch[1])))
		// Dedup per-language — keep the first (the page lists highest-rated first).
		if seen[lang] {
			continue
		}
		seen[lang] = true
		detailURL := c.endpoint + string(linkMatch[1])
		tracks = append(tracks, &relaxv1.SubtitleTrack{
			Language:       langCode(lang),
			Label:          displayLang(lang),
			Format:         "srt",
			SourceName:     "YIFYSubs",
			TrackReference: subtitles.PrefixRef("yifysubs", detailURL),
		})
	}
	return tracks, nil
}

func (c *Client) Download(ctx context.Context, ref string) (string, error) {
	if !strings.HasPrefix(ref, "http") {
		return "", fmt.Errorf("yifysubs: ref must be a URL, got %q", ref)
	}
	// Convention used by yifysubtitles.ch: the zip lives at the same path
	// but under /subtitle/ (singular) with a .zip suffix.
	zipURL := strings.Replace(ref, "/subtitles/", "/subtitle/", 1) + ".zip"
	body, err := c.fetch(ctx, zipURL, ref)
	if err != nil {
		return "", err
	}
	srt, err := firstSRTInZip(body)
	if err != nil {
		return "", err
	}
	return srtToVTT(srt), nil
}

func (c *Client) fetch(ctx context.Context, url, referer string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("yifysubs: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yifysubs: status %d", resp.StatusCode)
	}
	// Cap response size at 8 MiB so a bad endpoint can't blow memory.
	return io.ReadAll(io.LimitReader(resp.Body, 8<<20))
}

func firstSRTInZip(body []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return "", fmt.Errorf("yifysubs: zip: %w", err)
	}
	for _, f := range zr.File {
		if !strings.EqualFold(extOf(f.Name), ".srt") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		data, err := io.ReadAll(io.LimitReader(rc, 4<<20))
		_ = rc.Close()
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	return "", fmt.Errorf("yifysubs: no .srt in archive")
}

func extOf(name string) string {
	i := strings.LastIndex(name, ".")
	if i < 0 {
		return ""
	}
	return name[i:]
}

var commaTimecode = regexp.MustCompile(`(\d{2}:\d{2}:\d{2}),(\d{3})`)

func srtToVTT(srt string) string {
	cleaned := strings.ReplaceAll(srt, "\r\n", "\n")
	cleaned = strings.ReplaceAll(cleaned, "\r", "\n")
	cleaned = strings.TrimPrefix(cleaned, "\xef\xbb\xbf")
	converted := commaTimecode.ReplaceAllString(cleaned, "$1.$2")
	return "WEBVTT\n\n" + converted
}

// yifysubtitles shows full language names ("English", "Spanish") — map a
// handful to ISO codes so the renderer can use them as <track srclang>.
var langCodes = map[string]string{
	"english": "en", "spanish": "es", "french": "fr", "german": "de",
	"italian": "it", "portuguese": "pt", "russian": "ru", "japanese": "ja",
	"korean": "ko", "chinese": "zh", "arabic": "ar", "hindi": "hi",
	"dutch": "nl", "polish": "pl", "turkish": "tr", "swedish": "sv",
	"danish": "da", "finnish": "fi", "norwegian": "nb", "czech": "cs",
	"romanian": "ro", "hungarian": "hu", "thai": "th", "vietnamese": "vi",
	"indonesian": "id", "ukrainian": "uk", "hebrew": "he",
}

func langCode(name string) string {
	if c, ok := langCodes[name]; ok {
		return c
	}
	if len(name) >= 2 {
		return name[:2]
	}
	return name
}

func displayLang(name string) string {
	if name == "" {
		return "Unknown"
	}
	return strings.ToUpper(name[:1]) + name[1:]
}
