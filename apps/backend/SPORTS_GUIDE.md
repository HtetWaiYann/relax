# RELAX Sports — How Live Streams Are Found

How the Sports page goes from "Arsenal vs Chelsea is live" to a playing video,
with a focus on `SPORTS_ADDON_URL`: what it points at, how the backend searches
it for a match, and how the stream reaches the player.

All code lives in `apps/backend/internal/sports/` plus the two RPC handlers in
`internal/server/sports_handlers.go`.

---

## 1. The big picture

RELAX combines **two independent sources**:

| Source | Answers | Configured by |
| --- | --- | --- |
| football-data.org | *Which matches are on, when, what's the score?* | `FOOTBALL_DATA_API_KEY`, `SPORTS_COMPETITIONS` |
| A Stremio-protocol addon | *Where can I watch this match?* | `SPORTS_ADDON_URL` |

They know nothing about each other. football-data.org doesn't know where to
watch, and the addon doesn't share football-data's match ids. The only link
between them is **team names**, which is why name matching (section 5) is
central to how this works.

```
 Renderer                      Backend (Go)                          Outside world
 ────────                      ────────────                          ─────────────
 Sports page ──GetTodayMatches──▶ Fixtures.Between ─────────────────▶ football-data.org
                                                                       /v4/matches
 Match page  ──GetMatchStreams──▶ Fixtures.ByID ───────────────────▶ football-data.org
                                  │                                    /v4/matches/{id}
                                  ▼
                                 Addon.StreamsFor ─────────────────▶ SPORTS_ADDON_URL
                                  │  1. manifest.json                  (Stremio addon)
                                  │  2. catalog/{type}/{id}.json  (×N)
                                  │  3. findEvent(home, away)
                                  │  4. stream/{type}/{eventId}.json
                                  ▼
                                 Proxy.Register (one session per stream)
                                  │
 Live player ◀── play_url ────────┘   "/live/{sid}?u=<upstream>"
     │
     └── hls.js GET /live/... ──▶ Proxy.ServeHTTP ──(+ headers)──────▶ stream CDN
                                   (rewrites playlists)                 .m3u8 / .ts
```

---

## 2. What `SPORTS_ADDON_URL` is

A **Stremio addon** is any HTTP server that serves JSON files at fixed paths.
Stremio defined the paths; Torrentio (used for movies in RELAX) is one example.
A sports addon follows the same protocol but lists events or channels
instead of movies.

You can set either form; the trailing `/manifest.json` is stripped in
`NewAddon`:

```env
SPORTS_ADDON_URL=https://addon.example.com
SPORTS_ADDON_URL=https://addon.example.com/manifest.json
```

Empty means streams are disabled. The match page then shows "No stream
source configured" (`source_configured = false` in the response), and
fixtures still work.

The three endpoints RELAX uses:

| Endpoint | Purpose | Shape we read |
| --- | --- | --- |
| `GET /manifest.json` | What does this addon offer? | `catalogs[] { type, id, extra[], extraRequired[] }` |
| `GET /catalog/{type}/{id}.json` | List the items in one catalog | `metas[] { id, type, name }` |
| `GET /stream/{type}/{id}.json` | Playable sources for one item | `streams[] { name, title, description, url, behaviorHints.proxyHeaders.request }` |

---

## 3. Step 1 — Fixtures (football-data.org)

**`GetTodayMatches(day_start, day_end)`**: despite the name, it serves any
day. The renderer sends its own local midnight-to-midnight, so "today" follows
the user's timezone.

`Fixtures.Between` (`footballdata.go`):

1. football-data filters by **UTC date**, and a local day can straddle two UTC
   dates. We ask for `dateFrom = UTC date of start` and
   `dateTo = UTC date of end + 1 day`, then trim to the exact window with
   `filterRange`.
2. Results are cached **per range**. A range containing *now* has a 30s
   TTL (live scores); any other day has a 10-minute TTL. The free tier allows
   10 requests/min, so this keeps us under it.
3. Each raw match becomes a `relaxv1.Match`. `mapStatus` collapses
   football-data's statuses: `TIMED/SCHEDULED → SCHEDULED`,
   `IN_PLAY/LIVE → LIVE`, `PAUSED → PAUSED` (half-time),
   `FINISHED/AWARDED → FINISHED`, `POSTPONED/SUSPENDED/CANCELLED → POSTPONED`.

**`GetMatchStreams(match_id)`** first calls `Fixtures.ByID`, a fresh
`/v4/matches/{id}` call, so the match header shows the current score. That
match's team names drive the rest of the search.

---

## 4. Step 2 — Collecting events from the addon

`Addon.StreamsFor(ctx, home, away)` in `addon.go`:

```
manifest.json
   └─ for each catalog:
        skip if it needs a required "extra" (search/genre/…)   ← hasRequiredExtra
        GET /catalog/{type}/{id}.json
        append every meta to `events` (inherit catalog type if meta has none)
```

- **Why skip catalogs with required extras?** A catalog that needs, for
  example, `search=` can't be listed on its own. Asking without the parameter
  returns nothing or an error.
- **A failing catalog doesn't fail the search.** It's logged
  (`addon catalog failed`) and skipped.
- `home` and `away` are **lists of names**: `[full name, short name]` from
  football-data, e.g. `["Manchester United FC", "Man United"]`. Either one can
  match.

---

## 5. Step 3 — Matching a fixture to an addon event

This is the core of the search (`match.go`). The addon might call the match
`"Man United v Liverpool | Premier League"` while football-data says
`"Manchester United FC"` and `"Liverpool FC"`.

### 5.1 `normalize`

Turns any name into a comparable token string:

1. Lowercase.
2. Fold accents: `Atlético → atletico`, `Barça → barca`.
3. Split on anything that isn't a letter or digit (`-`, `|`, `.`, `:`…).
4. Drop **noise tokens** that differ between sources:
   `fc cf afc sc cd ud rcd rc sd club de the vs v`.
5. Join with single spaces and **pad with a space on both sides**.

```
"Club Atlético de Madrid"                → " atletico madrid "
"Man United v Liverpool | Premier League" → " man united liverpool premier league "
```

The padding makes the next step a **whole-word** check: `" real madrid "`
can't accidentally match inside `" surreal madrids "`.

### 5.2 `mentions` and `findEvent`

```
for each event (in catalog order):
    e := normalize(event.name)
    if  any(normalize(n) ⊂ e for n in home)
    and any(normalize(n) ⊂ e for n in away):
        return event           ← first match wins
```

Both teams must appear. One team isn't enough, which stops
`Arsenal vs Barcelona` from matching an `Arsenal vs Chelsea` event.

| Fixture (football-data) | Addon event | Result |
| --- | --- | --- |
| Manchester United FC / Man United vs Liverpool FC | `Man United v Liverpool \| Premier League` | ✅ via short name |
| Club Atlético de Madrid vs Real Betis Balompié / Real Betis | `Atlético Madrid - Real Betis` | ✅ |
| Real Madrid CF vs FC Barcelona | `Real Madrid vs Barcelona` | ✅ |
| Tottenham Hotspur FC / Tottenham vs … | `Spurs vs …` | ❌ nickname |

**Known limit:** nicknames and abbreviations ("Spurs", "Wolves", "PSG",
"Inter") won't match unless football-data's short name happens to use them.
The fix is a small alias map; see `ponytail:` in `findEvent`.

**No match is not an error.** `StreamsFor` returns an empty list and logs:

```
no addon event for match  home=[...] away=[...] events=42 sample=[up to 30 event names]
```

`sample` is the quickest way to see why a match wasn't found.

---

## 6. Step 4 — Getting the streams

For the matched event:

```
GET /stream/{event.type}/{event.id}.json
```

Only entries with a direct **`url`** are kept. Stremio streams can also be
`infoHash` (torrent), `ytId` (YouTube) or `externalUrl` (open in a browser).
Those are dropped because the live player only plays HLS over HTTP.

Each kept stream carries:

- `name`: shown as the card title (newlines flattened).
- `title`, or failing that `description`: shown as the subtitle.
- `url`: the upstream `.m3u8`.
- `behaviorHints.proxyHeaders.request`: headers the CDN **requires**,
  typically `Referer`, `Origin`, `User-Agent`. Restream CDNs commonly reject
  requests without the right `Referer`.

---

## 7. Step 5 — The HLS proxy (`/live/`)

The renderer never receives upstream URLs. For each stream,
`GetMatchStreams` calls `Proxy.Register(url, headers)` and returns
`play_url = /live/{sid}?u=<escaped upstream url>`.

### Why a proxy at all?

1. **Headers.** A `<video>` element (and hls.js's fetches) can't set
   `Referer` or `User-Agent`. The proxy adds them server-side.
2. **CSP.** The Electron window only allows media and fetches from the
   backend. Proxying keeps the CSP strict instead of opening it to `*`.
3. **CORS.** Many CDNs send no CORS headers. The backend's own CORS
   middleware covers `/live/`.

### Session model

```go
sessions[sid] = { headers, hosts: {upstream host}, expires: now + 6h }
```

- `sid` is 16 random bytes in hex. Unknown or expired sid → **404**.
- **Host allowlist:** a session may only fetch hosts that were the original
  URL's host or **appeared in one of its playlists**. Requests for any other
  host → 404.
- **Public addresses only:** the dialer (`publicOnly`) refuses loopback,
  private, link-local and unspecified IPs. This is checked at connect time,
  so it covers redirects and DNS tricks too. A malicious playlist can't make
  the backend probe your LAN or `localhost`.
- Expired sessions are cleaned up whenever a new one is registered.

### What `ServeHTTP` does per request

```
GET /live/{sid}?u=<target>
  ├─ validate sid + target host  → 404 if not allowed
  ├─ fetch target with browser UA + session headers (+ Range if sent)
  ├─ peek first 7 bytes
  │    "#EXTM3U" or Content-Type contains "mpegurl"?
  │      yes → playlist: read (≤ 5 MB), rewrite, serve as application/vnd.apple.mpegurl
  │      no  → segment/key: stream bytes through unchanged
```

It sniffs the content instead of trusting `Content-Type`, because restream
hosts often serve playlists as `text/plain` or `application/octet-stream`.

### Playlist rewriting

Every URI in a playlist is resolved against the **post-redirect** playlist
URL and turned back into a proxy URL. The resolved host is added to the
session's allowlist at the same time.

```
#EXTM3U                                    #EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"    #EXT-X-KEY:METHOD=AES-128,URI="/live/ab12…?u=https%3A%2F%2Fcdn…%2Fkey.bin"
#EXTINF:4.0,                         →     #EXTINF:4.0,
seg1.ts                                    /live/ab12…?u=https%3A%2F%2Fcdn…%2Fseg1.ts
https://other.cdn/seg2.ts                  /live/ab12…?u=https%3A%2F%2Fother.cdn%2Fseg2.ts
```

- Plain lines (segments, variant playlists) are rewritten.
- `URI="…"` attributes inside tags (`EXT-X-KEY`, `EXT-X-MAP`, `EXT-X-MEDIA`,
  `EXT-X-I-FRAME-STREAM-INF`) are rewritten.
- Non-HTTP URIs (`data:`, `skd://`) are left alone.
- Proxy URLs are **root-relative**. hls.js resolves them against the
  backend origin, so the proxy never needs to know its own port.

---

## 8. Step 6 — Playback in the renderer

`pages/LiveWatch.tsx`:

- `hls.js` loads `backendUrl() + play_url` with `enableWorker: false`. The
  worker would load from a `blob:` URL that the CSP's `worker-src` blocks.
- **Failover:** on a *fatal* hls.js error the player moves to the next stream
  automatically, and shows "All streams failed" after the last one.
- The stream `<select>` in the top bar switches sources manually.
- The match page refetches streams every 60s while the match is live, so
  streams that appear near kickoff show up without leaving the page.

---

## 9. Failure modes at a glance

| What you see | Where it comes from | Likely cause |
| --- | --- | --- |
| "Couldn't load fixtures: … FOOTBALL_DATA_API_KEY is not set" | `ErrNoAPIKey` → `FailedPrecondition` | Key missing in `.env` |
| "No stream source configured" | `source_configured = false` | `SPORTS_ADDON_URL` empty |
| "No streams found yet" + log `sports addon failed` | `StreamsFor` returned an error | Addon down, bad URL, non-JSON reply |
| "No streams found yet" + log `no addon event for match` | `findEvent` found nothing | Names differ (check `sample`), or event not listed yet |
| "No streams found yet", neither log | Event matched, but no stream had a `url` | Addon only offers torrents / external links for it |
| Player: "All streams failed" | Every stream hit a fatal hls.js error | Dead restreams, wrong headers, or blocked private address |

Errors from the addon never fail the RPC. The page still renders the match
header and an empty stream list, the same policy Torrentio uses for movies.

---

## 10. Testing when nothing is live

```env
SPORTS_DEBUG_MATCH=Arsenal vs Chelsea
```

This adds a fake **LIVE** fixture (id `MaxInt32`, kicked off 30 min ago) to
the current day's list. Opening it runs steps 2–6 for real; only the fixture
is synthetic.

1. Set any two names and restart the backend.
2. Open the debug match. If there are no streams, read the `sample=` log line.
3. Copy two team names from a listed event into `SPORTS_DEBUG_MATCH` and
   restart.
4. If `sample` shows **channel names** (e.g. "Sports Channel 1") rather than
   matches, the addon is channel-based, and team-name matching can't work
   with it.

Clear the variable when you're done.

---

## 11. Configuration reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `FOOTBALL_DATA_API_KEY` | — | Required for the Sports page. Free key at football-data.org. |
| `SPORTS_COMPETITIONS` | `PL,PD` | Comma-separated competition codes. The free tier covers `PL PD SA BL1 FL1 DED PPL ELC BSA CL EC WC`; unknown or paid codes are silently ignored by the API. |
| `SPORTS_ADDON_URL` | — | Stremio addon base or `manifest.json` URL. Empty disables streams. |
| `SPORTS_DEBUG_MATCH` | — | `"Home vs Away"` fake live fixture for testing. |

---

## 12. Known limits / upgrade paths

- **One addon only.** Supporting a comma-separated list means looping
  `StreamsFor` and merging results.
- **Catalogs are re-fetched on every match open.** Cache the manifest and
  catalogs briefly if an addon has many catalogs.
- **No nickname aliases** (section 5.2).
- **Byte-range playlists** (`EXT-X-BYTERANGE`) need `Range` added to the
  CORS allowed headers.
- **Fixture cache is unbounded** per session (one entry per day viewed).
- The RPC is still named `GetTodayMatches` although it serves any day.
  Renaming it is a breaking proto change.
