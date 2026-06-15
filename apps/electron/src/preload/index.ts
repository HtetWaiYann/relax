import { contextBridge, ipcRenderer } from 'electron';

const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:8080';

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
}

export interface SubtitleTrack {
  language: string;
  label: string;
  url: string;
  format: string;
  sourceName: string;
  trackReference: string;
}

const api = {
  getBackendUrl: (): string => BACKEND_URL,
  getAppName: (): string => 'RELAX',
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
