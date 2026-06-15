package opensubtitles

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	relaxv1 "relax/gen/relax/v1"
)

var ErrQuotaExceeded = errors.New("opensubtitles: daily download quota exceeded")

const (
	baseURL   = "https://api.opensubtitles.com/api/v1"
	userAgent = "RELAX/1.0"
)

type Client struct {
	apiKey string
	http   *http.Client
}

func New(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 15 * time.Second},
	}
}

type osSearchResponse struct {
	Data []struct {
		Attributes struct {
			Language string `json:"language"`
			Files    []struct {
				FileID   int64  `json:"file_id"`
				FileName string `json:"file_name"`
			} `json:"files"`
		} `json:"attributes"`
	} `json:"data"`
}

type osDownloadRequest struct {
	FileID int64 `json:"file_id"`
}

type osDownloadResponse struct {
	Link      string `json:"link"`
	Remaining int    `json:"remaining"`
	Message   string `json:"message"`
}

// Search returns OpenSubtitles tracks for the given IMDB ID.
// season and episode are 0 for movies.
func (c *Client) Search(ctx context.Context, imdbID string, season, episode int32) ([]*relaxv1.SubtitleTrack, error) {
	url := fmt.Sprintf("%s/subtitles?imdb_id=%s", baseURL, imdbID)
	if season > 0 {
		url += fmt.Sprintf("&season_number=%d&episode_number=%d", season, episode)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Api-Key", c.apiKey)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("opensubtitles search: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("opensubtitles search: status %d", resp.StatusCode)
	}

	var result osSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("opensubtitles search decode: %w", err)
	}

	// Deduplicate by language — keep first (highest-rated by API default ordering).
	seen := map[string]bool{}
	var tracks []*relaxv1.SubtitleTrack
	for _, item := range result.Data {
		lang := item.Attributes.Language
		if len(item.Attributes.Files) == 0 {
			continue
		}
		file := item.Attributes.Files[0]
		key := lang
		label := langName(lang)
		if seen[key] {
			// Disambiguate with a counter suffix.
			label = fmt.Sprintf("%s (%d)", label, len(tracks)+1)
		} else {
			seen[key] = true
		}
		tracks = append(tracks, &relaxv1.SubtitleTrack{
			Language:       lang,
			Label:          label,
			Url:            "",
			Format:         "srt",
			SourceName:     "OpenSubtitles",
			TrackReference: fmt.Sprintf("%d", file.FileID),
		})
	}
	return tracks, nil
}

// Download fetches a subtitle by file ID, converts to VTT, and returns the VTT content.
func (c *Client) Download(ctx context.Context, fileID string) (string, error) {
	var id int64
	if _, err := fmt.Sscanf(fileID, "%d", &id); err != nil {
		return "", fmt.Errorf("invalid file_id: %s", fileID)
	}

	body, _ := json.Marshal(osDownloadRequest{FileID: id})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/download", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Api-Key", c.apiKey)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("opensubtitles download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusNotAcceptable {
		return "", ErrQuotaExceeded
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("opensubtitles download: status %d", resp.StatusCode)
	}

	var dl osDownloadResponse
	if err := json.NewDecoder(resp.Body).Decode(&dl); err != nil {
		return "", fmt.Errorf("opensubtitles download decode: %w", err)
	}
	if dl.Remaining == 0 && dl.Link == "" {
		return "", ErrQuotaExceeded
	}

	// Fetch the actual subtitle file.
	srtReq, err := http.NewRequestWithContext(ctx, http.MethodGet, dl.Link, nil)
	if err != nil {
		return "", fmt.Errorf("fetch subtitle: %w", err)
	}
	srtResp, err := c.http.Do(srtReq)
	if err != nil {
		return "", fmt.Errorf("fetch subtitle: %w", err)
	}
	defer srtResp.Body.Close()
	srtBytes, err := io.ReadAll(srtResp.Body)
	if err != nil {
		return "", fmt.Errorf("read subtitle: %w", err)
	}

	return srtToVTT(string(srtBytes)), nil
}

var commaTimecode = regexp.MustCompile(`(\d{2}:\d{2}:\d{2}),(\d{3})`)

func srtToVTT(srt string) string {
	cleaned := strings.ReplaceAll(srt, "\r\n", "\n")
	cleaned = strings.ReplaceAll(cleaned, "\r", "\n")
	cleaned = strings.TrimPrefix(cleaned, "\xef\xbb\xbf")
	converted := commaTimecode.ReplaceAllString(cleaned, "$1.$2")
	return "WEBVTT\n\n" + converted
}

// langName maps ISO 639 codes to display names for common languages.
var langNames = map[string]string{
	"en": "English", "es": "Spanish", "fr": "French", "de": "German",
	"it": "Italian", "pt": "Portuguese", "ru": "Russian", "ja": "Japanese",
	"ko": "Korean", "zh": "Chinese", "ar": "Arabic", "hi": "Hindi",
	"nl": "Dutch", "pl": "Polish", "tr": "Turkish", "sv": "Swedish",
	"da": "Danish", "fi": "Finnish", "nb": "Norwegian", "cs": "Czech",
	"ro": "Romanian", "hu": "Hungarian", "th": "Thai", "vi": "Vietnamese",
	"id": "Indonesian", "uk": "Ukrainian", "he": "Hebrew",
}

func langName(code string) string {
	if name, ok := langNames[strings.ToLower(code)]; ok {
		return name
	}
	return strings.ToUpper(code)
}
