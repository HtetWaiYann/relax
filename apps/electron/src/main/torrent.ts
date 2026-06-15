// Torrent engine + local HTTP range server + subtitle helpers.
// Runs in the Electron main process so renderer can stream over a plain
// <video> element. Provider-agnostic on the surface — a future debrid
// provider can satisfy the same start/stop/stats/subtitles contract.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain, type WebContents } from 'electron';
import process from 'node:process';
import mime from 'mime-types';
// @ts-expect-error — webtorrent ships no types
import WebTorrent from 'webtorrent';

const STREAM_PORT = Number(process.env['STREAM_PORT'] ?? 8088);
const KEEP_DOWNLOADS = process.env['KEEP_DOWNLOADS'] !== 'false';
// ~15s @ ~6 Mbps bitrate. Tune later if needed.
const INITIAL_BUFFER_BYTES = Number(process.env['INITIAL_BUFFER_BYTES'] ?? 12 * 1024 * 1024);
const STATS_INTERVAL_MS = 1000;

interface StartArgs {
  infoHash: string;
  fileIdx: number;
  magnetUri: string;
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
}

interface Subtitle {
  language: string;
  label: string;
  url: string;
  format: string;
}

interface Session {
  fileIdx: number;
  initialDownloaded: number;
  bufferingComplete: boolean;
  statsTimer?: NodeJS.Timeout;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TorrentLike = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FileLike = any;

const downloadDir = join(app.getPath('userData'), 'torrents');
mkdirSync(downloadDir, { recursive: true });

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

// ponytail: drain a leading read-stream to force the first N bytes to download
// sequentially. Browser range requests later pull on demand, which webtorrent
// turns into piece criticals — so the look-ahead window follows playback.
function primeInitialBuffer(file: FileLike, sess: Session, onUpdate: () => void) {
  const end = Math.min(INITIAL_BUFFER_BYTES, file.length) - 1;
  const stream = file.createReadStream({ start: 0, end });
  stream.on('data', (chunk: Buffer) => {
    sess.initialDownloaded += chunk.length;
    onUpdate();
  });
  stream.on('end', () => {
    sess.bufferingComplete = true;
    onUpdate();
  });
  stream.on('error', (err: Error) => {
    console.warn('[torrent] prebuffer error', err);
    sess.bufferingComplete = true;
    onUpdate();
  });
}

function buildStats(torrent: TorrentLike, sess: Session): Stats {
  const totalNeeded = Math.min(INITIAL_BUFFER_BYTES, fileFor(torrent, sess.fileIdx)?.length ?? 0);
  const initial = totalNeeded > 0 ? Math.min(1, sess.initialDownloaded / totalNeeded) : 1;
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
    sess = { fileIdx, initialDownloaded: 0, bufferingComplete: false };
    sessions.set(args.infoHash, sess);
    const tick = () => broadcastStats(args.infoHash, buildStats(torrent, sess!));
    sess.statsTimer = setInterval(tick, STATS_INTERVAL_MS);
    primeInitialBuffer(file, sess, tick);
  }

  return {
    streamUrl: `http://localhost:${STREAM_PORT}/stream/${args.infoHash}/${fileIdx}`,
    torrentName: torrent.name ?? '',
    fileName: file.name,
    totalSizeBytes: file.length,
  };
}

async function stop(infoHash: string): Promise<void> {
  const sess = sessions.get(infoHash);
  if (sess?.statsTimer) clearInterval(sess.statsTimer);
  sessions.delete(infoHash);
  subscribers.delete(infoHash);
  if (!client) return;
  const torrent = await getTorrent(infoHash);
  if (!torrent) return;
  // KEEP_DOWNLOADS: keep files on disk; just destroy the network connections.
  await new Promise<void>((resolve) => {
    client.remove(infoHash, { destroyStore: !KEEP_DOWNLOADS }, () => resolve());
  });
}

async function setPosition(infoHash: string, fileIdx: number, positionSeconds: number) {
  // ponytail: rely on read-stream-driven criticals (range requests reset the
  // priority window). Explicitly hint at the next ~30s only when the player
  // tells us it's seeking far ahead — webtorrent will requeue piece priorities.
  const t = await getTorrent(infoHash);
  const file = t ? fileFor(t, fileIdx) : null;
  if (!t || !file) return;
  // Rough bytes-per-second from runtime-best-guess (we don't have bitrate);
  // pick a generous 30s slice and ask webtorrent to grab those pieces first.
  if (positionSeconds < 0 || !Number.isFinite(positionSeconds)) return;
  const totalSeconds = guessDurationSeconds(file);
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
      // still allow if it's the only subtitle present
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
    });
  });
  return out;
}

function guessLang(name: string): string {
  const m = /\.([a-z]{2,3})\.(srt|vtt)$/i.exec(name);
  return m ? m[1].toLowerCase() : 'en';
}

async function getSubtitles(infoHash: string, fileIdx: number): Promise<Subtitle[]> {
  const t = await getTorrent(infoHash);
  if (!t) return [];
  await waitReady(t);
  return findSubtitleFiles(t, fileIdx);
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

async function handleStream(req: IncomingMessage, res: ServerResponse, infoHash: string, fileIdx: number) {
  const t = await getTorrent(infoHash);
  const file = t ? fileFor(t, fileIdx) : null;
  if (!file) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const size = file.length;
  const contentType = mime.lookup(file.name) || 'video/mp4';
  const range = parseRange(req.headers.range, size);

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

  const { start, end } = range;
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': contentType,
  });
  const stream = file.createReadStream({ start, end });
  stream.pipe(res);
  req.on('close', () => stream.destroy());
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
  ipcMain.handle('torrent:set-position', async (_e, args: { infoHash: string; fileIdx: number; positionSeconds: number }) =>
    setPosition(args.infoHash, args.fileIdx, args.positionSeconds),
  );
  ipcMain.handle('torrent:get-subtitles', async (_e, args: { infoHash: string; fileIdx: number }) =>
    getSubtitles(args.infoHash, args.fileIdx),
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
