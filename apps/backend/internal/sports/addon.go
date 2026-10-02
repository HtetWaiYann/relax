package sports

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

// browserUA: many addons and their CDNs reject Go's default User-Agent.
const browserUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Addon speaks the Stremio addon protocol against one base URL:
// manifest.json → catalog/{type}/{id}.json → stream/{type}/{id}.json.
type Addon struct {
	baseURL string
	http    *http.Client
}

func NewAddon(baseURL string) *Addon {
	return &Addon{
		baseURL: strings.TrimSuffix(strings.TrimRight(baseURL, "/"), "/manifest.json"),
		http:    &http.Client{Timeout: httpTimeout},
	}
}

func (a *Addon) Configured() bool { return a.baseURL != "" }

type addonManifest struct {
	Catalogs []struct {
		Type          string       `json:"type"`
		ID            string       `json:"id"`
		Extra         []addonExtra `json:"extra"`
		ExtraRequired []string     `json:"extraRequired"`
	} `json:"catalogs"`
}

type addonExtra struct {
	IsRequired bool `json:"isRequired"`
}

type addonMeta struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Name string `json:"name"`
}

// AddonStream is one entry of a /stream response that has a direct URL.
type AddonStream struct {
	Name          string `json:"name"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	URL           string `json:"url"`
	BehaviorHints struct {
		ProxyHeaders struct {
			Request map[string]string `json:"request"`
		} `json:"proxyHeaders"`
	} `json:"behaviorHints"`
}

// StreamsFor finds the catalog event for home vs away and returns its streams.
// No matching event is not an error — it returns an empty slice.
func (a *Addon) StreamsFor(ctx context.Context, home, away []string) ([]AddonStream, error) {
	var mf addonManifest
	if err := a.get(ctx, "/manifest.json", &mf); err != nil {
		return nil, err
	}

	// ponytail: walks every catalog per lookup; cache the manifest/catalogs
	// if addons with many catalogs make this slow.
	var events []addonMeta
	for _, c := range mf.Catalogs {
		if hasRequiredExtra(c.Extra, c.ExtraRequired) {
			continue
		}
		var body struct {
			Metas []addonMeta `json:"metas"`
		}
		path := fmt.Sprintf("/catalog/%s/%s.json", url.PathEscape(c.Type), url.PathEscape(c.ID))
		if err := a.get(ctx, path, &body); err != nil {
			slog.Warn("addon catalog failed", "catalog", c.ID, "err", err)
			continue
		}
		for _, m := range body.Metas {
			if m.Type == "" {
				m.Type = c.Type
			}
			events = append(events, m)
		}
	}

	ev, ok := findEvent(events, home, away)
	if !ok {
		names := make([]string, 0, min(len(events), 30))
		for _, e := range events[:min(len(events), 30)] {
			names = append(names, e.Name)
		}
		// Logs a sample of what the addon lists, to see why names didn't match.
		slog.Info("no addon event for match", "home", home, "away", away, "events", len(events), "sample", names)
		return []AddonStream{}, nil
	}

	var body struct {
		Streams []AddonStream `json:"streams"`
	}
	path := fmt.Sprintf("/stream/%s/%s.json", url.PathEscape(ev.Type), url.PathEscape(ev.ID))
	if err := a.get(ctx, path, &body); err != nil {
		return nil, err
	}
	out := body.Streams[:0]
	for _, s := range body.Streams {
		if s.URL != "" { // drop infoHash/ytId/externalUrl entries
			out = append(out, s)
		}
	}
	return out, nil
}

// hasRequiredExtra skips catalogs we can't list without a search/genre param.
func hasRequiredExtra(extra []addonExtra, legacy []string) bool {
	if len(legacy) > 0 {
		return true
	}
	for _, e := range extra {
		if e.IsRequired {
			return true
		}
	}
	return false
}

func (a *Addon) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "application/json")
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("addon %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("addon %s: status %d", path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
