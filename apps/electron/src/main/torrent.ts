// Torrent engine + local HTTP range server + subtitle helpers.
// Runs in the Electron main process so renderer can stream over a plain
// <video> element. Provider-agnostic on the surface — a future debrid
// provider can satisfy the same start/stop/stats/subtitles contract.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain, type WebContents } from 'electron';
import process from 'node:process';
import mime from 'mime-types';
// @ts-expect-error — webtorrent ships no types
import WebTorrent from 'webtorrent';
import {
  audioNeedsTranscode,
  audioStreams,
  pickDefaultAudio,
  probeFile,
  spawnRemux,
  spawnSubtitleExtract,
  subtitleIsExtractable,
  subtitleStreams,
  type ProbeResult,
  type ProbeStream,
} from './ffmpeg';

const STREAM_PORT = Number(process.env['STREAM_PORT'] ?? 8088);
const KEEP_DOWNLOADS = import.meta.env.MAIN_VITE_KEEP_DOWNLOADS !== 'false';

// ~15s @ ~6 Mbps bitrate. Tune later if needed.
const INITIAL_BUFFER_BYTES = Number(process.env['INITIAL_BUFFER_BYTES'] ?? 12 * 1024 * 1024);
// ponytail: window is for resume hinting, not for active eviction.
// KEEP_DOWNLOADS=true is the lazy implementation of "keep pieces around
// the position" — webtorrent already detects existing pieces on disk on
// re-add, so resume reads from cache directly.
const CACHE_WINDOW_MB = Number(process.env['CACHE_WINDOW_MB'] ?? 50);
const STATS_INTERVAL_MS = 1000;

interface StartArgs {
  infoHash: string;
  fileIdx: number;
  magnetUri: string;
  positionSeconds?: number;
  title?: string;
  posterUrl?: string;
}

interface StartResult {
  streamUrl: string;
  torrentName: string;
  fileName: string;
  totalSizeBytes: number;
}

interface Stats {
  infoHash: string;
  downloadSpeedBps: number;
  uploadSpeedBps: number;
  progress: number;
  numPeers: number;
  numSeeds: number;
  downloadedBytes: number;
  initialBufferProgress: number;
  bufferingComplete: boolean;
  // Probe-derived. Both 0 until the initial buffer is drained and ffprobe
  // returns. The renderer uses durationSeconds as a fallback when the live
  // remux pipe doesn't carry duration in its container header, and needsRemux
  // tells the UI which seek strategy to use.
  durationSeconds: number;
  needsRemux: boolean;
}

interface Subtitle {
  language: string;
  label: string;
  url: string;
  format: string;
  sourceName: string;
  trackReference: string;
  supported: boolean;
}

interface AudioTrack {
  // Stable id = source stream index in the container.
  id: string;
  // 0-based position among audio streams; used for -map 0:a:N.
  typeIndex: number;
  language: string;
  label: string;
  codec: string;
  channels: number;
  isDefault: boolean;
}

interface Session {
  fileIdx: number;
  filePath: string;
  initialDownloaded: number;
  bufferingComplete: boolean;
  statsTimer?: NodeJS.Timeout;
  probe: ProbeResult | null;
  probePromise?: Promise<void>;
  selectedAudioTypeIdx: number;
  // Cache: subtitle typeIdx -> extracted VTT text.
  mkvSubCache: Map<number, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TorrentLike = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FileLike = any;

const downloadDir = join(app.getPath('userData'), 'torrents');
mkdirSync(downloadDir, { recursive: true });

// Sidecar JSON mapping infoHash -> display metadata. Lets the Settings page
// show poster/title for each cached torrent without coupling Go's storage
// layer to Electron's userData layout.
// ponytail: tiny JSON beats a second DB; rewritten in-place on each start.
const cacheIndexPath = join(app.getPath('userData'), 'cache_index.json');
interface CacheIndexEntry {
  infoHash: string;
  torrentName: string;
  title: string;
  posterUrl: string;
  lastAccessedAt: number;
}
function readCacheIndex(): Record<string, CacheIndexEntry> {
  try {
    return JSON.parse(readFileSync(cacheIndexPath, 'utf8')) as Record<string, CacheIndexEntry>;
  } catch {
    return {};
  }
}
function writeCacheIndex(idx: Record<string, CacheIndexEntry>) {
  try {
    writeFileSync(cacheIndexPath, JSON.stringify(idx));
  } catch (err) {
    console.warn('[torrent] cache_index write failed', err);
  }
}
function touchCacheEntry(partial: Partial<CacheIndexEntry> & { infoHash: string }) {
  const idx = readCacheIndex();
  const prev = idx[partial.infoHash] ?? { infoHash: partial.infoHash, torrentName: '', title: '', posterUrl: '', lastAccessedAt: 0 };
  idx[partial.infoHash] = { ...prev, ...partial, lastAccessedAt: Date.now() };
  writeCacheIndex(idx);
}

// Persisted user setting for auto-eviction. 0 = disabled.
const cacheSettingsPath = join(app.getPath('userData'), 'cache_settings.json');
interface CacheSettings { ttlDays: number }
function readCacheSettings(): CacheSettings {
  try { return JSON.parse(readFileSync(cacheSettingsPath, 'utf8')) as CacheSettings; }
  catch { return { ttlDays: 0 }; }
}
function writeCacheSettings(s: CacheSettings) {
  try { writeFileSync(cacheSettingsPath, JSON.stringify(s)); }
  catch (err) { console.warn('[torrent] cache_settings write failed', err); }
}

// Marked-as-finished hashes — stop() destroys the store for these even when
// KEEP_DOWNLOADS=true. In-memory only: the renderer marks at 90% playback
// and stop() runs on navigate-back, so persistence across app restarts isn't
// needed (a re-launched session never triggers stop without first playing).
const finishedHashes = new Set<string>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any | null = null;
const sessions = new Map<string, Session>();
const subscribers = new Map<string, Set<WebContents>>();

function ensureClient() {
  if (!client) {
    client = new WebTorrent();
    client.on('error', (err: Error) => console.error('[torrent] client error', err));
  }
  return client;
}

async function getTorrent(infoHash: string): Promise<TorrentLike | null> {
  return client ? await client.get(infoHash) : null;
}

async function waitReady(torrent: TorrentLike): Promise<TorrentLike> {
  if (torrent.ready) return torrent;
  if (typeof torrent.once !== 'function') return torrent;
  await new Promise<void>((resolve) => torrent.once('ready', () => resolve()));
  return torrent;
}

function fileFor(torrent: TorrentLike, fileIdx: number): FileLike | null {
  if (!torrent?.files || fileIdx < 0 || fileIdx >= torrent.files.length) return null;
  return torrent.files[fileIdx];
}

function pickInitialFile(torrent: TorrentLike, hint: number): number {
  if (hint >= 0 && hint < torrent.files.length) return hint;
  // Pick the largest video-looking file.
  let bestIdx = 0;
  let bestLen = 0;
  torrent.files.forEach((f: FileLike, i: number) => {
    if (/\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.name) && f.length > bestLen) {
      bestLen = f.length;
      bestIdx = i;
    }
  });
  return bestIdx;
}

function selectOnly(torrent: TorrentLike, fileIdx: number) {
  torrent.files.forEach((f: FileLike, i: number) => {
    if (i === fileIdx) f.select();
    else f.deselect();
  });
}

function absoluteFilePath(torrent: TorrentLike, file: FileLike): string {
  // webtorrent stores all files under torrent.path joined with file.path
  // (file.path is the relative path within the torrent).
  return join(torrent.path ?? downloadDir, file.path ?? file.name);
}

// ponytail: drain a leading read-stream to force the first N bytes to download
// sequentially. Browser range requests later pull on demand, which webtorrent
// turns into piece criticals — so the look-ahead window follows playback.
// Probe is kicked in parallel as soon as enough header is on disk — running
// it in series with the full prebuffer drain was the main cause of the
// extra "initial buffering" wall time after this commit landed.
const PROBE_TRIGGER_BYTES = 2 * 1024 * 1024;
function primeInitialBuffer(file: FileLike, sess: Session, onUpdate: () => void) {
  const end = Math.min(INITIAL_BUFFER_BYTES, file.length) - 1;
  const stream = file.createReadStream({ start: 0, end });
  let probeKicked = false;
  const kickProbe = () => {
    if (probeKicked) return;
    probeKicked = true;
    void ensureProbe(sess);
  };
  stream.on('data', (chunk: Buffer) => {
    sess.initialDownloaded += chunk.length;
    onUpdate();
    if (sess.initialDownloaded >= PROBE_TRIGGER_BYTES) kickProbe();
  });
  stream.on('end', () => {
    sess.bufferingComplete = true;
    onUpdate();
    kickProbe();
  });
  stream.on('error', (err: Error) => {
    console.warn('[torrent] prebuffer error', err);
    sess.bufferingComplete = true;
    onUpdate();
    kickProbe();
  });
}

async function ensureProbe(sess: Session): Promise<void> {
  if (sess.probe || sess.probePromise) {
    if (sess.probePromise) await sess.probePromise;
    return;
  }
  sess.probePromise = (async () => {
    if (!existsSync(sess.filePath)) {
      console.warn('[ffmpeg] probe skipped — file path missing', sess.filePath);
      return;
    }
    const probe = await probeFile(sess.filePath);
    sess.probe = probe;
    const def = pickDefaultAudio(probe);
    if (def) sess.selectedAudioTypeIdx = def.typeIndex;
    if (probe) {
      const audio = audioStreams(probe);
      const needsTranscode = audio.some((a) => audioNeedsTranscode(a.codecName));
      console.log(
        `[ffmpeg] probe ${sess.filePath} — duration=${probe.durationSeconds.toFixed(0)}s ` +
        `audio=[${audio.map((a) => `${a.codecName}/${a.language || '?'}`).join(',')}] ` +
        `transcode=${needsTranscode}`,
      );
    }
  })();
  try { await sess.probePromise; } finally { sess.probePromise = undefined; }
}

function buildStats(torrent: TorrentLike, sess: Session): Stats {
  const totalNeeded = Math.min(INITIAL_BUFFER_BYTES, fileFor(torrent, sess.fileIdx)?.length ?? 0);
  const initial = totalNeeded > 0 ? Math.min(1, sess.initialDownloaded / totalNeeded) : 1;
  const audios = audioStreams(sess.probe);
  const selectedAudio = audios.find((a) => a.typeIndex === sess.selectedAudioTypeIdx);
  return {
    infoHash: torrent.infoHash,
    downloadSpeedBps: Math.round(torrent.downloadSpeed ?? 0),
    uploadSpeedBps: Math.round(torrent.uploadSpeed ?? 0),
    progress: Number(torrent.progress ?? 0),
    numPeers: Number(torrent.numPeers ?? 0),
    // webtorrent doesn't split seeds vs peers cleanly; expose 0 unless wires report it.
    numSeeds: countSeeds(torrent),
    downloadedBytes: Number(torrent.downloaded ?? 0),
    initialBufferProgress: initial,
    bufferingComplete: sess.bufferingComplete,
    durationSeconds: sess.probe?.durationSeconds ?? 0,
    needsRemux: !!sess.probe && audioNeedsTranscode(selectedAudio?.codecName),
  };
}

function countSeeds(torrent: TorrentLike): number {
  // ponytail: best-effort seed count. webtorrent's `wires` expose `isSeeder`.
  if (!Array.isArray(torrent.wires)) return 0;
  let n = 0;
  for (const w of torrent.wires) if (w?.isSeeder) n++;
  return n;
}

function broadcastStats(infoHash: string, stats: Stats) {
  const set = subscribers.get(infoHash);
  if (!set) return;
  for (const wc of set) {
    if (!wc.isDestroyed()) wc.send('torrent:stats', stats);
  }
}

async function start(args: StartArgs): Promise<StartResult> {
  const c = ensureClient();
  const torrent: TorrentLike = await new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    c.once('error', onError);
    c.add(args.magnetUri, { path: downloadDir }, (t: TorrentLike) => {
      c.off('error', onError);
      resolve(t);
    });
  });
  await waitReady(torrent);

  const fileIdx = pickInitialFile(torrent, args.fileIdx);
  selectOnly(torrent, fileIdx);

  const file = fileFor(torrent, fileIdx);
  if (!file) throw new Error('no file at index');

  let sess = sessions.get(args.infoHash);
  if (!sess) {
    sess = {
      fileIdx,
      filePath: absoluteFilePath(torrent, file),
      initialDownloaded: 0,
      bufferingComplete: false,
      probe: null,
      selectedAudioTypeIdx: 0,
      mkvSubCache: new Map(),
    };
    sessions.set(args.infoHash, sess);
    const tick = () => broadcastStats(args.infoHash, buildStats(torrent, sess!));
    sess.statsTimer = setInterval(tick, STATS_INTERVAL_MS);
    primeInitialBuffer(file, sess, tick);
  }

  // Mark the cache entry so the Settings page can show it. Title/poster are
  // best-effort; on plain Start they may be empty, on Resume they come from
  // the watch_progress row the caller pulled.
  touchCacheEntry({
    infoHash: args.infoHash,
    torrentName: torrent.name ?? '',
    title: args.title ?? '',
    posterUrl: args.posterUrl ?? '',
  });

  // Resume hint: nudge piece priorities toward the resume byte. webtorrent
  // detects on-disk pieces and reads them straight from the file — the cache
  // window is implicit, not actively trimmed.
  if (args.positionSeconds && args.positionSeconds > 0) {
    void setPosition(args.infoHash, fileIdx, args.positionSeconds);
  }

  // For passthrough mode the renderer seeks via video.currentTime after
  // loadedmetadata. For remux mode we'd embed ?t=, but we can't tell remux
  // vs passthrough until probe lands — the renderer handles either path.
  return {
    streamUrl: `http://localhost:${STREAM_PORT}/stream/${args.infoHash}/${fileIdx}`,
    torrentName: torrent.name ?? '',
    fileName: file.name,
    totalSizeBytes: file.length,
  };
}

interface CacheStatsResult {
  totalAppBytes: number;
  cacheBytes: number;
  dbBytes: number;
  entries: Array<{
    infoHash: string;
    torrentName: string;
    title: string;
    posterUrl: string;
    cachedBytes: number;
    lastAccessedAt: number;
  }>;
}

function dirSize(p: string): number {
  let total = 0;
  let st;
  try { st = statSync(p); } catch { return 0; }
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  for (const name of readdirSync(p)) total += dirSize(join(p, name));
  return total;
}

function getCacheStats(): CacheStatsResult {
  const idx = readCacheIndex();
  const userData = app.getPath('userData');
  const dbPath = join(userData, 'relax.db');
  const cacheBytes = dirSize(downloadDir);
  const totalAppBytes = dirSize(userData);
  const dbBytes = (() => { try { return statSync(dbPath).size; } catch { return 0; } })();

  const entries: CacheStatsResult['entries'] = [];
  const seenNames = new Set<string>();
  for (const e of Object.values(idx)) {
    const dir = e.torrentName ? join(downloadDir, e.torrentName) : '';
    const cachedBytes = dir ? dirSize(dir) : 0;
    if (cachedBytes <= 0) continue;
    seenNames.add(e.torrentName);
    entries.push({
      infoHash: e.infoHash,
      torrentName: e.torrentName,
      title: e.title || e.torrentName,
      posterUrl: e.posterUrl,
      cachedBytes,
      lastAccessedAt: e.lastAccessedAt,
    });
  }
  // ponytail: also surface orphan on-disk folders (started before index existed).
  try {
    for (const name of readdirSync(downloadDir)) {
      if (seenNames.has(name)) continue;
      const dir = join(downloadDir, name);
      const cachedBytes = dirSize(dir);
      if (cachedBytes <= 0) continue;
      entries.push({
        infoHash: '',
        torrentName: name,
        title: name,
        posterUrl: '',
        cachedBytes,
        lastAccessedAt: (() => { try { return statSync(dir).mtimeMs; } catch { return 0; } })(),
      });
    }
  } catch { /* downloadDir missing — fine */ }
  entries.sort((a, b) => b.cachedBytes - a.cachedBytes);
  return { totalAppBytes, cacheBytes, dbBytes, entries };
}

async function clearCache(infoHash?: string): Promise<{ freedBytes: number }> {
  let freedBytes = 0;
  const idx = readCacheIndex();
  if (infoHash) {
    const entry = idx[infoHash];
    if (entry?.torrentName) {
      const dir = join(downloadDir, entry.torrentName);
      freedBytes += dirSize(dir);
      // Also destroy the running torrent if it exists.
      const t = await getTorrent(infoHash);
      if (t) {
        await new Promise<void>((resolve) => client.remove(infoHash, { destroyStore: true }, () => resolve()));
      } else {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
      }
      delete idx[infoHash];
      writeCacheIndex(idx);
    }
    return { freedBytes };
  }
  // Full wipe.
  freedBytes += dirSize(downloadDir);
  // Remove all active torrents first.
  if (client) {
    const torrents = (client.torrents as TorrentLike[]) ?? [];
    await Promise.all(torrents.map((t) =>
      new Promise<void>((resolve) => client.remove(t.infoHash, { destroyStore: true }, () => resolve())),
    ));
  }
  try { rmSync(downloadDir, { recursive: true, force: true }); } catch { /* noop */ }
  mkdirSync(downloadDir, { recursive: true });
  writeCacheIndex({});
  return { freedBytes };
}

async function stop(infoHash: string): Promise<void> {
  const sess = sessions.get(infoHash);
  if (sess?.statsTimer) clearInterval(sess.statsTimer);
  sessions.delete(infoHash);
  subscribers.delete(infoHash);
  if (!client) return;
  const torrent = await getTorrent(infoHash);
  if (!torrent) return;
  // Finished (>=90% watched) overrides KEEP_DOWNLOADS — free disk once the
  // viewer is unlikely to come back.
  const destroyStore = finishedHashes.has(infoHash) || !KEEP_DOWNLOADS;
  await new Promise<void>((resolve) => {
    client.remove(infoHash, { destroyStore }, () => resolve());
  });
  if (destroyStore) {
    finishedHashes.delete(infoHash);
    const idx = readCacheIndex();
    if (idx[infoHash]) { delete idx[infoHash]; writeCacheIndex(idx); }
  }
}

// Walk the cache index and remove entries older than the configured TTL.
// Skips anything with an active session (currently playing).
function evictOldEntries() {
  const { ttlDays } = readCacheSettings();
  if (ttlDays <= 0) return;
  const cutoff = Date.now() - ttlDays * 86_400_000;
  const idx = readCacheIndex();
  let changed = false;
  for (const [hash, e] of Object.entries(idx)) {
    if (sessions.has(hash)) continue;
    if (e.lastAccessedAt > cutoff) continue;
    if (e.torrentName) {
      try { rmSync(join(downloadDir, e.torrentName), { recursive: true, force: true }); }
      catch { /* noop */ }
    }
    delete idx[hash];
    changed = true;
  }
  // ponytail: orphan dirs (started before index existed) — judge by mtime.
  try {
    const indexedNames = new Set(Object.values(idx).map((e) => e.torrentName));
    for (const name of readdirSync(downloadDir)) {
      if (indexedNames.has(name)) continue;
      const dir = join(downloadDir, name);
      try {
        const st = statSync(dir);
        if (st.mtimeMs <= cutoff) rmSync(dir, { recursive: true, force: true });
      } catch { /* noop */ }
    }
  } catch { /* noop */ }
  if (changed) writeCacheIndex(idx);
}

async function setPosition(infoHash: string, fileIdx: number, positionSeconds: number) {
  // ponytail: rely on read-stream-driven criticals (range requests reset the
  // priority window). Explicitly hint at the next ~30s only when the player
  // tells us it's seeking far ahead — webtorrent will requeue piece priorities.
  const t = await getTorrent(infoHash);
  const file = t ? fileFor(t, fileIdx) : null;
  if (!t || !file) return;
  if (positionSeconds < 0 || !Number.isFinite(positionSeconds)) return;
  const sess = sessions.get(infoHash);
  const totalSeconds = sess?.probe?.durationSeconds ?? guessDurationSeconds(file);
  if (totalSeconds <= 0) return;
  const bytesPerSec = file.length / totalSeconds;
  const startByte = Math.max(0, Math.floor(positionSeconds * bytesPerSec));
  const endByte = Math.min(file.length - 1, startByte + Math.floor(bytesPerSec * 30));
  const stream = file.createReadStream({ start: startByte, end: endByte });
  stream.resume();
  stream.on('error', () => undefined);
}

function guessDurationSeconds(file: FileLike): number {
  // ponytail: filename rarely has duration. Assume 1.5h for movies; we just
  // use this for piece-priority hinting, not anything user-facing.
  const length: number = file.length;
  if (length > 8 * 1024 * 1024 * 1024) return 3 * 3600; // big files ≈ 3h
  if (length > 3 * 1024 * 1024 * 1024) return 2 * 3600;
  return 5400;
}

function findSubtitleFiles(torrent: TorrentLike, videoIdx: number): Subtitle[] {
  if (!torrent?.files) return [];
  const videoName = (torrent.files[videoIdx]?.name ?? '').replace(/\.[^.]+$/, '').toLowerCase();
  const out: Subtitle[] = [];
  torrent.files.forEach((f: FileLike, i: number) => {
    const lower = f.name.toLowerCase();
    if (!/\.(srt|vtt)$/i.test(lower)) return;
    // Match if the subtitle name shares a prefix with the video, or if there's
    // only one video and one subtitle in the torrent.
    const base = lower.replace(/\.[^.]+$/, '');
    if (videoName && base.indexOf(videoName.slice(0, 12)) === -1) {
      if (torrent.files.filter((x: FileLike) => /\.(srt|vtt)$/i.test(x.name)).length > 1) return;
    }
    const lang = guessLang(f.name);
    const fmt = lower.endsWith('.vtt') ? 'vtt' : 'srt';
    const url = `http://localhost:${STREAM_PORT}/sub/${torrent.infoHash}/${i}.vtt`;
    out.push({
      language: lang,
      label: lang.toUpperCase() || f.name,
      url,
      format: fmt,
      sourceName: 'Embedded',
      trackReference: url,
      supported: true,
    });
  });
  return out;
}

function guessLang(name: string): string {
  const m = /\.([a-z]{2,3})\.(srt|vtt)$/i.exec(name);
  return m ? m[1].toLowerCase() : 'en';
}

// MKV-embedded subtitle streams discovered via ffprobe. Text-based formats
// (subrip/ass/ssa/webvtt) get a working URL backed by an ffmpeg extract;
// bitmap formats (PGS/HDMV) are returned with supported=false.
function mkvEmbeddedSubs(infoHash: string, sess: Session): Subtitle[] {
  const subs = subtitleStreams(sess.probe);
  return subs.map((s) => {
    const lang = (s.language || 'und').toLowerCase();
    const label = displayLabel(s, lang);
    const extractable = subtitleIsExtractable(s.codecName);
    return {
      language: lang,
      label: `${label} · ${s.codecName.toUpperCase()}`,
      url: extractable
        ? `http://localhost:${STREAM_PORT}/mkvsub/${infoHash}/${sess.fileIdx}/${s.typeIndex}.vtt`
        : '',
      format: extractable ? 'vtt' : s.codecName,
      sourceName: 'Embedded (MKV)',
      trackReference: `mkv:${infoHash}:${sess.fileIdx}:${s.typeIndex}`,
      supported: extractable,
    };
  });
}

function displayLabel(s: ProbeStream, lang: string): string {
  if (s.title) return s.title;
  if (lang && lang !== 'und') return lang.toUpperCase();
  return `Track ${s.typeIndex + 1}`;
}

async function getSubtitles(infoHash: string, fileIdx: number): Promise<Subtitle[]> {
  const t = await getTorrent(infoHash);
  if (!t) return [];
  await waitReady(t);
  const loose = findSubtitleFiles(t, fileIdx);
  const sess = sessions.get(infoHash);
  if (!sess) return loose;
  // ponytail: never await the probe here — the renderer fires this on mount
  // and we don't want subtitle discovery to delay playback. If the probe has
  // landed, include MKV-embedded streams; otherwise the renderer re-polls
  // once probe completes (see VideoPlayer.tsx).
  return sess.probe ? [...loose, ...mkvEmbeddedSubs(infoHash, sess)] : loose;
}

async function getAudioTracks(infoHash: string, fileIdx: number): Promise<AudioTrack[]> {
  const sess = sessions.get(infoHash);
  if (!sess || sess.fileIdx !== fileIdx) return [];
  await ensureProbe(sess);
  return audioStreams(sess.probe).map((a) => ({
    id: String(a.index),
    typeIndex: a.typeIndex,
    language: (a.language || 'und').toLowerCase(),
    label: a.title || `${(a.language || 'und').toUpperCase()} (${a.codecName}${a.channels ? ` ${a.channels}ch` : ''})`,
    codec: a.codecName,
    channels: a.channels ?? 0,
    isDefault: a.isDefault,
  }));
}

function streamURL(infoHash: string, fileIdx: number, atSeconds: number): string {
  const t = Math.max(0, atSeconds || 0).toFixed(3);
  return `http://localhost:${STREAM_PORT}/stream/${infoHash}/${fileIdx}?t=${t}&_=${Date.now()}`;
}

async function switchAudioTrack(infoHash: string, fileIdx: number, typeIndex: number, atSeconds: number): Promise<{ streamUrl: string }> {
  const sess = sessions.get(infoHash);
  if (!sess || sess.fileIdx !== fileIdx) {
    return { streamUrl: `http://localhost:${STREAM_PORT}/stream/${infoHash}/${fileIdx}` };
  }
  await ensureProbe(sess);
  const audios = audioStreams(sess.probe);
  if (audios.find((a) => a.typeIndex === typeIndex)) {
    sess.selectedAudioTypeIdx = typeIndex;
  }
  return { streamUrl: streamURL(infoHash, fileIdx, atSeconds) };
}

async function seekStream(infoHash: string, fileIdx: number, atSeconds: number): Promise<{ streamUrl: string }> {
  return { streamUrl: streamURL(infoHash, fileIdx, atSeconds) };
}

// ---------- HTTP server (range + subtitles) ----------

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /bytes=(\d+)-(\d*)/.exec(header);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) return null;
  return { start, end };
}

function srtToVtt(srt: string): string {
  // Strip BOM, normalise line endings, convert ',' decimal to '.' in timecodes.
  const cleaned = srt
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${cleaned}`;
}

async function readFileToBuffer(file: FileLike): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const s = file.createReadStream();
    s.on('data', (c: Buffer) => chunks.push(c));
    s.on('end', () => resolve(Buffer.concat(chunks)));
    s.on('error', reject);
  });
}

async function handleStream(
  req: IncomingMessage,
  res: ServerResponse,
  infoHash: string,
  fileIdx: number,
) {
  const t = await getTorrent(infoHash);
  const file = t ? fileFor(t, fileIdx) : null;
  if (!file) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const sess = sessions.get(infoHash);
  // Don't await probe — it was kicked during prebuffer and is almost always
  // ready by now. If not, serve passthrough; the file is most likely a
  // Chromium-native codec (which is what passthrough handles correctly).
  // Files that genuinely need remux (EAC3/DTS/TrueHD) race-lose this on
  // very fast first requests, but probe completes within ms after that.

  const audios = audioStreams(sess?.probe ?? null);
  const selectedAudio = audios.find((a) => a.typeIndex === (sess?.selectedAudioTypeIdx ?? 0));
  const transcodeAudio = audioNeedsTranscode(selectedAudio?.codecName);
  const audioOverride = !!sess?.probe
    && audios.length > 1
    && sess.selectedAudioTypeIdx !== (pickDefaultAudio(sess.probe)?.typeIndex ?? 0);
  const remux = !!sess?.probe && (transcodeAudio || audioOverride);

  const size = file.length;
  const contentType = remux ? 'video/mp4' : (mime.lookup(file.name) || 'video/mp4');
  const range = parseRange(req.headers.range, size);
  // ?t={seconds} overrides byte-range math — used by the renderer to seek in
  // remux mode where Chromium can't compute byte offsets natively.
  const tMatch = /[?&]t=([0-9.]+)/.exec(req.url ?? '');
  const explicitStartSeconds = tMatch ? Math.max(0, parseFloat(tMatch[1])) : null;

  console.log(
    `[stream] ${req.method} ${req.url} range=${req.headers.range ?? 'none'} ` +
    `mode=${remux ? 'remux' : 'passthrough'} audio=${sess?.selectedAudioTypeIdx ?? 0}`,
  );

  if (!remux) {
    if (!range) {
      res.writeHead(200, {
        'Content-Length': size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      const stream = file.createReadStream();
      stream.pipe(res);
      req.on('close', () => stream.destroy());
      return;
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': range.end - range.start + 1,
      'Content-Type': contentType,
    });
    const stream = file.createReadStream({ start: range.start, end: range.end });
    stream.pipe(res);
    req.on('close', () => stream.destroy());
    return;
  }

  // Remux path. Two ways the renderer can ask for a seek:
  //   1) ?t={seconds} — explicit time offset (used by the UI's seek-bar swap)
  //   2) Range: bytes=N- — Chromium's native byte-offset seek; we map back
  //      to time via probe duration ratio.
  const duration = sess?.probe?.durationSeconds ?? 0;
  const start = range?.start ?? 0;
  const rangeStartSeconds = duration > 0 ? (start / size) * duration : 0;
  const startSeconds = explicitStartSeconds ?? rangeStartSeconds;

  // Live remux: chunked transfer, no Content-Length. Telling Chromium a fake
  // total would make it report a truncated download when ffmpeg's output
  // doesn't match the lie. Accept-Ranges left at "bytes" so the player can
  // still request bytes=0- on the initial request.
  res.writeHead(200, {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });

  const ff = spawnRemux({
    filePath: sess!.filePath,
    audioTypeIdx: sess?.selectedAudioTypeIdx ?? 0,
    startSeconds,
    transcodeAudio,
  });
  ff.stderr.on('data', (chunk: Buffer) => {
    // Only log warnings/errors — at -loglevel warning these are sparse.
    const s = chunk.toString().trim();
    if (s) console.log(`[ffmpeg] ${s}`);
  });
  ff.stdout.pipe(res);
  const kill = () => { try { ff.kill('SIGKILL'); } catch { /* noop */ } };
  req.on('close', kill);
  ff.on('error', (err) => { console.warn('[ffmpeg] spawn failed', err); kill(); });
}

async function handleSubtitle(res: ServerResponse, infoHash: string, fileIdx: number) {
  const t = await getTorrent(infoHash);
  const file = t ? fileFor(t, fileIdx) : null;
  if (!file) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  try {
    const buf = await readFileToBuffer(file);
    const text = buf.toString('utf8');
    const vtt = file.name.toLowerCase().endsWith('.vtt') ? text : srtToVtt(text);
    res.writeHead(200, {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(vtt);
  } catch (err) {
    console.warn('[torrent] subtitle read failed', err);
    res.writeHead(500);
    res.end('subtitle read failed');
  }
}

async function handleMkvSubtitle(
  res: ServerResponse,
  infoHash: string,
  fileIdx: number,
  streamTypeIdx: number,
) {
  const sess = sessions.get(infoHash);
  if (!sess || sess.fileIdx !== fileIdx) {
    res.writeHead(404);
    res.end('no session');
    return;
  }
  await ensureProbe(sess);
  const sub = subtitleStreams(sess.probe).find((s) => s.typeIndex === streamTypeIdx);
  if (!sub || !subtitleIsExtractable(sub.codecName)) {
    res.writeHead(415);
    res.end('subtitle stream not extractable');
    return;
  }
  const cached = sess.mkvSubCache.get(streamTypeIdx);
  if (cached !== undefined) {
    res.writeHead(200, {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(cached);
    return;
  }

  const ff = spawnSubtitleExtract(sess.filePath, streamTypeIdx);
  const chunks: Buffer[] = [];
  ff.stdout.on('data', (c: Buffer) => chunks.push(c));
  ff.stderr.on('data', (c: Buffer) => {
    const s = c.toString().trim();
    if (s) console.log(`[ffmpeg-sub] ${s}`);
  });
  ff.on('close', (code) => {
    if (code !== 0 && chunks.length === 0) {
      res.writeHead(500);
      res.end('subtitle extract failed');
      return;
    }
    const vtt = Buffer.concat(chunks).toString('utf8');
    sess.mkvSubCache.set(streamTypeIdx, vtt);
    res.writeHead(200, {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(vtt);
  });
  ff.on('error', (err) => {
    console.warn('[ffmpeg-sub] spawn failed', err);
    res.writeHead(500);
    res.end('subtitle extract spawn failed');
  });
}

export function startStreamServer() {
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = req.url || '';
    let m = /^\/stream\/([a-f0-9]+)\/(\d+)/i.exec(url);
    if (m) {
      void handleStream(req, res, m[1].toLowerCase(), parseInt(m[2], 10));
      return;
    }
    m = /^\/mkvsub\/([a-f0-9]+)\/(\d+)\/(\d+)\.vtt/i.exec(url);
    if (m) {
      void handleMkvSubtitle(res, m[1].toLowerCase(), parseInt(m[2], 10), parseInt(m[3], 10));
      return;
    }
    m = /^\/sub\/([a-f0-9]+)\/(\d+)\.vtt/i.exec(url);
    if (m) return handleSubtitle(res, m[1].toLowerCase(), parseInt(m[2], 10));
    res.writeHead(404);
    res.end('not found');
  });
  server.listen(STREAM_PORT, '127.0.0.1', () => {
    console.log(`[torrent] stream server on http://localhost:${STREAM_PORT}`);
  });
  return server;
}

export const STREAM_BASE_URL = `http://localhost:${STREAM_PORT}`;

// ---------- IPC handlers ----------

export function registerTorrentIpc() {
  ipcMain.handle('torrent:start', async (_e, args: StartArgs) => start(args));
  ipcMain.handle('torrent:stop', async (_e, infoHash: string) => stop(infoHash));
  ipcMain.handle('cache:stats', async () => getCacheStats());
  ipcMain.handle('cache:clear', async (_e, infoHash?: string) => clearCache(infoHash));
  ipcMain.handle('cache:mark-finished', async (_e, infoHash: string) => {
    finishedHashes.add(infoHash.toLowerCase());
  });
  ipcMain.handle('cache:get-ttl-days', async () => readCacheSettings().ttlDays);
  ipcMain.handle('cache:set-ttl-days', async (_e, days: number) => {
    writeCacheSettings({ ttlDays: Math.max(0, Math.floor(days)) });
    evictOldEntries();
  });
  // Run eviction once at startup and hourly thereafter.
  setTimeout(evictOldEntries, 30_000);
  setInterval(evictOldEntries, 60 * 60 * 1000);
  ipcMain.handle('app:paths', async () => ({
    userData: app.getPath('userData'),
    torrents: downloadDir,
    cacheWindowMb: CACHE_WINDOW_MB,
    keepDownloads: KEEP_DOWNLOADS,
  }));
  ipcMain.handle('torrent:set-position', async (_e, args: { infoHash: string; fileIdx: number; positionSeconds: number }) =>
    setPosition(args.infoHash, args.fileIdx, args.positionSeconds),
  );
  ipcMain.handle('torrent:get-subtitles', async (_e, args: { infoHash: string; fileIdx: number }) =>
    getSubtitles(args.infoHash, args.fileIdx),
  );
  ipcMain.handle('torrent:get-audio-tracks', async (_e, args: { infoHash: string; fileIdx: number }) =>
    getAudioTracks(args.infoHash, args.fileIdx),
  );
  ipcMain.handle('torrent:switch-audio', async (_e, args: { infoHash: string; fileIdx: number; typeIndex: number; atSeconds: number }) =>
    switchAudioTrack(args.infoHash, args.fileIdx, args.typeIndex, args.atSeconds ?? 0),
  );
  ipcMain.handle('torrent:seek', async (_e, args: { infoHash: string; fileIdx: number; atSeconds: number }) =>
    seekStream(args.infoHash, args.fileIdx, args.atSeconds ?? 0),
  );
  ipcMain.on('torrent:subscribe', (e, infoHash: string) => {
    let set = subscribers.get(infoHash);
    if (!set) {
      set = new Set();
      subscribers.set(infoHash, set);
    }
    set.add(e.sender);
    e.sender.once('destroyed', () => set?.delete(e.sender));
  });
  ipcMain.on('torrent:unsubscribe', (e, infoHash: string) => {
    subscribers.get(infoHash)?.delete(e.sender);
  });
}
