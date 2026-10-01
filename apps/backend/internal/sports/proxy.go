package sports

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	// ProxyPrefix is where the proxy is mounted on the backend mux.
	ProxyPrefix      = "/live/"
	sessionTTL       = 6 * time.Hour
	maxPlaylistBytes = 5 << 20
)

var errBlockedAddr = errors.New("refusing to proxy to a non-public address")

// Proxy relays HLS playlists and segments, adding the upstream headers an
// addon asked for (behaviorHints.proxyHeaders) and rewriting playlist URIs
// back through itself. It only fetches hosts registered for a session, and
// never private/loopback addresses, so it can't be used as an open proxy
// into the local network.
type Proxy struct {
	http *http.Client

	mu       sync.Mutex
	sessions map[string]*session
}

type session struct {
	headers map[string]string
	hosts   map[string]bool
	expires time.Time
}

func NewProxy() *Proxy {
	dialer := &net.Dialer{Timeout: httpTimeout, Control: publicOnly}
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.DialContext = dialer.DialContext
	t.Proxy = nil // a local HTTP_PROXY would trip publicOnly
	return &Proxy{
		http:     &http.Client{Transport: t, Timeout: 30 * time.Second},
		sessions: map[string]*session{},
	}
}

func publicOnly(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return errBlockedAddr
	}
	return nil
}

// Register opens a session for an upstream stream and returns its
// root-relative proxy URL.
func (p *Proxy) Register(rawURL string, headers map[string]string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", fmt.Errorf("unsupported stream url %q", rawURL)
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	sid := hex.EncodeToString(b)

	now := time.Now()
	p.mu.Lock()
	defer p.mu.Unlock()
	for k, s := range p.sessions {
		if now.After(s.expires) {
			delete(p.sessions, k)
		}
	}
	p.sessions[sid] = &session{headers: headers, hosts: map[string]bool{u.Host: true}, expires: now.Add(sessionTTL)}
	return proxyURL(sid, u.String()), nil
}

func proxyURL(sid, target string) string {
	return ProxyPrefix + sid + "?u=" + url.QueryEscape(target)
}

// lookup returns the session's headers if sid exists and may fetch host.
func (p *Proxy) lookup(sid, host string) (map[string]string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.sessions[sid]
	if !ok || !s.hosts[host] || time.Now().After(s.expires) {
		return nil, false
	}
	return s.headers, true
}

func (p *Proxy) allowHost(sid, host string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if s, ok := p.sessions[sid]; ok {
		s.hosts[host] = true
	}
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sid := strings.TrimPrefix(r.URL.Path, ProxyPrefix)
	target, err := url.Parse(r.URL.Query().Get("u"))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") {
		http.Error(w, "bad target", http.StatusBadRequest)
		return
	}
	headers, ok := p.lookup(sid, target.Host)
	if !ok {
		http.NotFound(w, r)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		http.Error(w, "bad target", http.StatusBadRequest)
		return
	}
	req.Header.Set("User-Agent", browserUA)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if rg := r.Header.Get("Range"); rg != "" {
		req.Header.Set("Range", rg)
	}
	resp, err := p.http.Do(req)
	if err != nil {
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Sniff instead of trusting Content-Type: restream hosts often serve
	// playlists as text/plain or octet-stream.
	br := bufio.NewReader(resp.Body)
	head, _ := br.Peek(7)
	if string(head) == "#EXTM3U" || strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "mpegurl") {
		body, err := io.ReadAll(io.LimitReader(br, maxPlaylistBytes))
		if err != nil {
			http.Error(w, "upstream error", http.StatusBadGateway)
			return
		}
		// Resolve against the post-redirect URL, not the one we asked for.
		out := p.rewrite(sid, resp.Request.URL, string(body))
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.WriteString(w, out)
		return
	}

	for _, h := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"} {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, br)
}

var uriAttr = regexp.MustCompile(`URI="([^"]+)"`)

// rewrite points every URI in an HLS playlist (segment lines, variant
// playlists, and URI="..." on #EXT-X-KEY/MAP/MEDIA tags) back through the proxy.
func (p *Proxy) rewrite(sid string, base *url.URL, body string) string {
	lines := strings.Split(body, "\n")
	for i, line := range lines {
		t := strings.TrimSpace(line)
		switch {
		case t == "":
		case strings.HasPrefix(t, "#"):
			lines[i] = uriAttr.ReplaceAllStringFunc(t, func(m string) string {
				return `URI="` + p.proxied(sid, base, uriAttr.FindStringSubmatch(m)[1]) + `"`
			})
		default:
			lines[i] = p.proxied(sid, base, t)
		}
	}
	return strings.Join(lines, "\n")
}

func (p *Proxy) proxied(sid string, base *url.URL, ref string) string {
	u, err := base.Parse(ref)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return ref // data:, skd:// etc. pass through untouched
	}
	p.allowHost(sid, u.Host)
	return proxyURL(sid, u.String())
}
