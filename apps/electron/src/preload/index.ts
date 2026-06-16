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
