import { contextBridge, ipcRenderer } from 'electron';

// Main passes the live backend URL via webPreferences.additionalArguments in
// packaged mode (dynamic port). Falls back to env var for `pnpm dev`.
function resolveBackendUrl(): string {
  const fromArgv = process.argv.find(a => a.startsWith('--backend-url='));
  if (fromArgv) return fromArgv.slice('--backend-url='.length);
  return process.env['BACKEND_URL'] ?? 'http://localhost:8080';
}

const BACKEND_URL = resolveBackendUrl();

export interface StartStreamArgs {
  infoHash: string;
  fileIdx: number;
  magnetUri: string;
  positionSeconds?: number;
  title?: string;
  posterUrl?: string;
}

export interface CacheStats {
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

export interface AppPaths {
  userData: string;
  torrents: string;
  cacheWindowMb: number;
  keepDownloads: boolean;
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

const api = {
  getBackendUrl: (): string => BACKEND_URL,
  getAppName: (): string => 'Relax',
  torrent: {
    start: (args: StartStreamArgs): Promise<StartStreamResult> =>
      ipcRenderer.invoke('torrent:start', args),
    stop: (infoHash: string): Promise<void> =>
      ipcRenderer.invoke('torrent:stop', infoHash),
    setPosition: (
      infoHash: string,
      fileIdx: number,
      positionSeconds: number,
    ): Promise<void> =>
      ipcRenderer.invoke('torrent:set-position', {
        infoHash,
        fileIdx,
        positionSeconds,
      }),
    getSubtitles: (
      infoHash: string,
      fileIdx: number,
    ): Promise<SubtitleTrack[]> =>
      ipcRenderer.invoke('torrent:get-subtitles', { infoHash, fileIdx }),
    getAudioTracks: (
      infoHash: string,
      fileIdx: number,
    ): Promise<AudioTrack[]> =>
      ipcRenderer.invoke('torrent:get-audio-tracks', { infoHash, fileIdx }),
    switchAudio: (
      infoHash: string,
      fileIdx: number,
      typeIndex: number,
      atSeconds: number,
    ): Promise<{ streamUrl: string }> =>
      ipcRenderer.invoke('torrent:switch-audio', { infoHash, fileIdx, typeIndex, atSeconds }),
    seek: (
      infoHash: string,
      fileIdx: number,
      atSeconds: number,
    ): Promise<{ streamUrl: string }> =>
      ipcRenderer.invoke('torrent:seek', { infoHash, fileIdx, atSeconds }),
    getCacheStats: (): Promise<CacheStats> =>
      ipcRenderer.invoke('cache:stats'),
    clearCache: (infoHash?: string): Promise<{ freedBytes: number }> =>
      ipcRenderer.invoke('cache:clear', infoHash),
    markCacheFinished: (infoHash: string): Promise<void> =>
      ipcRenderer.invoke('cache:mark-finished', infoHash),
    getCacheTtlDays: (): Promise<number> =>
      ipcRenderer.invoke('cache:get-ttl-days'),
    setCacheTtlDays: (days: number): Promise<void> =>
      ipcRenderer.invoke('cache:set-ttl-days', days),
    getAppPaths: (): Promise<AppPaths> =>
      ipcRenderer.invoke('app:paths'),
    subscribe: (
      infoHash: string,
      onStats: (stats: TorrentStatsEvent) => void,
    ): (() => void) => {
      ipcRenderer.send('torrent:subscribe', infoHash);
      const handler = (_: unknown, stats: TorrentStatsEvent) => {
        if (stats.infoHash === infoHash) onStats(stats);
      };
      ipcRenderer.on('torrent:stats', handler);
      return () => {
        ipcRenderer.off('torrent:stats', handler);
        ipcRenderer.send('torrent:unsubscribe', infoHash);
      };
    },
  },
} as const;

contextBridge.exposeInMainWorld('relax', api);

export type RelaxBridge = typeof api;
