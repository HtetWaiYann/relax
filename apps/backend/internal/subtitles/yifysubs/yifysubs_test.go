package yifysubs

import (
	"strings"
	"testing"
)

// One-shot check for the regex-driven HTML parsing — the only non-trivial
// branch in the package. If yifysubtitles.ch changes its layout this snaps.
func TestSearchParsesRowsFromHTML(t *testing.T) {
	body := []byte(`
<html><body>
<table class="other-subs">
  <tbody>
    <tr>
      <td class="rating-cell">5</td>
      <td class="flag-cell"><span class="sub-lang">English</span></td>
      <td><a href="/subtitles/the-matrix-yify-12345">The.Matrix.1999.YIFY</a></td>
    </tr>
    <tr>
      <td class="rating-cell">4</td>
      <td class="flag-cell"><span class="sub-lang">Spanish</span></td>
      <td><a href="/subtitles/the-matrix-yify-67890">Matrix.Espanol</a></td>
    </tr>
    <tr>
      <td class="rating-cell">3</td>
      <td class="flag-cell"><span class="sub-lang">English</span></td>
      <td><a href="/subtitles/the-matrix-yify-22222">duplicate-english</a></td>
    </tr>
  </tbody>
</table>
</body></html>`)

	rows := rowRe.FindAllSubmatch(body, -1)
	if len(rows) < 3 {
		t.Fatalf("rowRe failed to find rows: got %d", len(rows))
	}
	gotLangs := map[string]bool{}
	gotLinks := 0
	for _, r := range rows {
		l := langRe.FindSubmatch(r[1])
		k := linkRe.FindSubmatch(r[1])
		if l == nil || k == nil {
			continue
		}
		gotLangs[strings.ToLower(string(l[1]))] = true
		gotLinks++
	}
	if !gotLangs["english"] || !gotLangs["spanish"] {
		t.Fatalf("missing expected languages, got %v", gotLangs)
	}
	if gotLinks != 3 {
		t.Fatalf("expected 3 link matches, got %d", gotLinks)
	}
}

func TestSRTToVTTAddsHeaderAndDotTimecodes(t *testing.T) {
	srt := "1\r\n00:00:01,500 --> 00:00:02,750\r\nHello\r\n"
	vtt := srtToVTT(srt)
	if !strings.HasPrefix(vtt, "WEBVTT\n\n") {
		t.Fatalf("missing WEBVTT header: %q", vtt)
	}
	if !strings.Contains(vtt, "00:00:01.500 --> 00:00:02.750") {
		t.Fatalf("timecodes not converted: %q", vtt)
	}
}
