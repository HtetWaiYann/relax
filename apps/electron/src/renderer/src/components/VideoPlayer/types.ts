import { type MediaType } from '@relax/types';

export interface VideoPlayerProps {
  infoHash: string;
  fileIdx: number;
  streamUrl: string | undefined;
  title: string;
  subtitle?: string;
  quality?: string;
  sourceLabel?: string;
  tmdbId: number;
  mediaType: MediaType;
  season: number;
  episode: number;
  resumeSeconds?: number;
  magnetUri?: string;
  posterUrl?: string;
  onBack: () => void;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const HIDE_DELAY_MS = 3000;

// Order in which sourceNames appear in the subtitle menu. Empty groups are omitted.
export const SUBTITLE_GROUP_ORDER = ['Local', 'Embedded', 'Embedded (MKV)', 'OpenSubtitles', 'Wyzie', 'YIFYSubs'] as const;

// ponytail: English-only. Drop non-English tracks at ingest so they don't
// show up in the menu, auto-select, or get downloaded. If multi-language
// support is ever wanted, lift this into a user setting.
export const isEnglish = (lang: string | undefined) =>
  !!lang && /^en([_-]|$)|^eng$/i.test(lang);

export type TrackLoadState = 'loading' | 'error' | 'quota';
export type PanelKind = 'none' | 'subs' | 'audio' | 'speed' | 'stats';
