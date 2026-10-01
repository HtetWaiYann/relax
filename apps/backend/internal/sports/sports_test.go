package sports

import (
	"net/url"
	"strings"
	"testing"
)

func TestFindEvent(t *testing.T) {
	events := []addonMeta{
		{ID: "1", Name: "Arsenal vs Chelsea"},
		{ID: "2", Name: "Man United v Liverpool | Premier League"},
		{ID: "3", Name: "Atlético Madrid - Real Betis"},
		{ID: "4", Name: "Real Madrid vs Barcelona"},
	}
	cases := []struct {
		home, away []string
		want       string
	}{
		{[]string{"Manchester United FC", "Man United"}, []string{"Liverpool FC", "Liverpool"}, "2"},
		{[]string{"Club Atlético de Madrid", "Atleti", "Atletico Madrid"}, []string{"Real Betis Balompié", "Real Betis"}, "3"},
		{[]string{"Real Madrid CF", "Real Madrid"}, []string{"FC Barcelona", "Barça"}, "4"},
		// One team appearing in an event isn't enough.
		{[]string{"Arsenal FC", "Arsenal"}, []string{"Barcelona"}, ""},
	}
	for _, c := range cases {
		got, ok := findEvent(events, c.home, c.away)
		if (c.want == "") == ok || (ok && got.ID != c.want) {
			t.Errorf("findEvent(%v, %v) = %q,%v; want %q", c.home, c.away, got.ID, ok, c.want)
		}
	}
}

func TestRewritePlaylist(t *testing.T) {
	p := NewProxy()
	first, err := p.Register("https://cdn.example.com/live/index.m3u8", nil)
	if err != nil {
		t.Fatal(err)
	}
	sid := strings.TrimPrefix(strings.SplitN(first, "?", 2)[0], ProxyPrefix)
	base, _ := url.Parse("https://cdn.example.com/live/index.m3u8")

	in := "#EXTM3U\r\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\r\n#EXTINF:4.0,\r\nseg1.ts\r\n#EXTINF:4.0,\r\nhttps://other.example.net/seg2.ts\r\n"
	out := p.rewrite(sid, base, in)

	for _, want := range []string{
		`URI="` + proxyURL(sid, "https://cdn.example.com/live/key.bin") + `"`,
		proxyURL(sid, "https://cdn.example.com/live/seg1.ts"),
		proxyURL(sid, "https://other.example.net/seg2.ts"),
	} {
		if !strings.Contains(out, want) {
			t.Errorf("rewritten playlist missing %q:\n%s", want, out)
		}
	}
	if _, ok := p.lookup(sid, "other.example.net"); !ok {
		t.Error("host discovered in playlist should be allowed")
	}
	if _, ok := p.lookup(sid, "evil.example.org"); ok {
		t.Error("unseen host must not be allowed")
	}
}
