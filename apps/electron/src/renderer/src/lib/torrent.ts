import { useEffect, useState } from 'react';

export interface StartStreamArgs {
  infoHash: string;
  fileIdx: number;
  magnetUri: string;
}

export interface StartStreamResult {
  streamUrl: string;
  torrentName: string;
  fileName: string;
  totalSizeBytes: number;
}

export interface TorrentStatsEvent {
  infoHash: string;
  downloadSpeedBps: number;
  uploadSpeedBps: number;
  progress: number;
  numPeers: number;
  numSeeds: number;
  downloadedBytes: number;
  initialBufferProgress: number;
  bufferingComplete: boolean;
  durationSeconds: number;
  needsRemux: boolean;
}

export interface SubtitleTrack {
  language: string;
  label: string;
  url: string;
  format: string;
  sourceName: string;
  trackReference: string;
  supported: boolean;
}

export interface AudioTrack {
  id: string;
  typeIndex: number;
  language: string;
  label: string;
  codec: string;
  channels: number;
  isDefault: boolean;
}

export interface TorrentBridge {
  start(args: StartStreamArgs): Promise<StartStreamResult>;
  stop(infoHash: string): Promise<void>;
  setPosition(infoHash: string, fileIdx: number, positionSeconds: number): Promise<void>;
  getSubtitles(infoHash: string, fileIdx: number): Promise<SubtitleTrack[]>;
  getAudioTracks(infoHash: string, fileIdx: number): Promise<AudioTrack[]>;
  switchAudio(infoHash: string, fileIdx: number, typeIndex: number, atSeconds: number): Promise<{ streamUrl: string }>;
  seek(infoHash: string, fileIdx: number, atSeconds: number): Promise<{ streamUrl: string }>;
  subscribe(infoHash: string, onStats: (stats: TorrentStatsEvent) => void): () => void;
}

interface RelaxBridgeShape {
  getBackendUrl(): string;
  getAppName(): string;
  torrent: TorrentBridge;
}

declare global {
  interface Window {
    relax?: RelaxBridgeShape;
  }
}

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
];

export function buildMagnet(infoHash: string, title?: string): string {
  // magnet-uri parses xt literally — URLSearchParams encodes colons to %3A which
  // breaks infoHash extraction, so build the URI manually.
  const parts = [`xt=urn:btih:${infoHash.toLowerCase()}`];
  if (title) parts.push(`dn=${encodeURIComponent(title)}`);
  for (const tr of TRACKERS) parts.push(`tr=${encodeURIComponent(tr)}`);
  return `magnet:?${parts.join('&')}`;
}

const MISSING_BRIDGE_MESSAGE =
  'Torrent streaming is only available in the Electron app. Start it with `pnpm --filter @relax/electron dev`, not the raw Vite URL.';

function bridge(): TorrentBridge | null {
  return window.relax?.torrent ?? null;
}

function requireBridge(): TorrentBridge {
  const torrent = bridge();
  if (!torrent) throw new Error(MISSING_BRIDGE_MESSAGE);
  return torrent;
}

export async function startStream(args: StartStreamArgs): Promise<StartStreamResult> {
  return requireBridge().start(args);
}

export async function stopStream(infoHash: string): Promise<void> {
  await bridge()?.stop(infoHash);
}

export function setStreamPosition(infoHash: string, fileIdx: number, seconds: number) {
  void bridge()?.setPosition(infoHash, fileIdx, seconds);
}

export async function getStreamSubtitles(
  infoHash: string,
  fileIdx: number,
): Promise<SubtitleTrack[]> {
  return bridge()?.getSubtitles(infoHash, fileIdx) ?? [];
}

export async function getStreamAudioTracks(
  infoHash: string,
  fileIdx: number,
): Promise<AudioTrack[]> {
  return bridge()?.getAudioTracks(infoHash, fileIdx) ?? [];
}

export async function switchStreamAudio(
  infoHash: string,
  fileIdx: number,
  typeIndex: number,
  atSeconds: number,
): Promise<string | null> {
  const res = await bridge()?.switchAudio(infoHash, fileIdx, typeIndex, atSeconds);
  return res?.streamUrl ?? null;
}

export async function seekStreamUrl(
  infoHash: string,
  fileIdx: number,
  atSeconds: number,
): Promise<string | null> {
  const res = await bridge()?.seek(infoHash, fileIdx, atSeconds);
  return res?.streamUrl ?? null;
}

export function useTorrentStats(infoHash: string | null): TorrentStatsEvent | null {
  const [stats, setStats] = useState<TorrentStatsEvent | null>(null);
  useEffect(() => {
    if (!infoHash) return;
    setStats(null);
    const torrent = bridge();
    if (!torrent) return;
    const off = torrent.subscribe(infoHash, setStats);
    return off;
  }, [infoHash]);
  return stats;
}
