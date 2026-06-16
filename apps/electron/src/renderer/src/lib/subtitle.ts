import { useEffect, useState } from 'react';

export interface VttCue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleStyle {
  fontSize: number;
  color: string;
  background: 'none' | 'translucent' | 'solid';
  bottomPercent: number;
  outline: boolean;
}

export const DEFAULT_STYLE: SubtitleStyle = {
  fontSize: 22,
  color: '#ffffff',
  background: 'translucent',
  bottomPercent: 8,
  outline: true,
};

const STORE_KEY = 'relax.subtitleStyle.v1';

export function loadSubtitleStyle(): SubtitleStyle {
  if (typeof localStorage === 'undefined') return DEFAULT_STYLE;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_STYLE;
    return { ...DEFAULT_STYLE, ...(JSON.parse(raw) as Partial<SubtitleStyle>) };
  } catch {
    return DEFAULT_STYLE;
  }
}

export function saveSubtitleStyle(style: SubtitleStyle) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(style));
  } catch {
    // ignore quota / disabled storage
  }
}

// Minimal WebVTT parser — handles HH:MM:SS.mmm and MM:SS.mmm timestamps plus
// continuation lines. Ignores cue settings and styling blocks.
export function parseVtt(text: string): VttCue[] {
  // ﻿ == byte-order mark; strip if present.
  const cleaned = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const lines = cleaned.split('\n');
  const cues: VttCue[] = [];
  let i = 0;
  // skip header
  while (i < lines.length && !/^\d/.test(lines[i]) && !/-->/.test(lines[i])) i++;
  while (i < lines.length) {
    // skip blank
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;
    // optional id line (no --> on it)
    if (!lines[i].includes('-->')) i++;
    if (i >= lines.length) break;
    const m = /(\d+:?\d*:?\d*\.\d+)\s*-->\s*(\d+:?\d*:?\d*\.\d+)/.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const start = parseTimestamp(m[1]);
    const end = parseTimestamp(m[2]);
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i++;
    }
    cues.push({
      start,
      end,
      text: stripTags(textLines.join('\n')).trim(),
    });
  }
  return cues;
}

function parseTimestamp(s: string): number {
  const parts = s.split(':');
  let h = 0;
  let m = 0;
  let sec = 0;
  if (parts.length === 3) {
    h = Number(parts[0]);
    m = Number(parts[1]);
    sec = Number(parts[2]);
  } else if (parts.length === 2) {
    m = Number(parts[0]);
    sec = Number(parts[1]);
  } else {
    sec = Number(parts[0]);
  }
  return h * 3600 + m * 60 + sec;
}

function stripTags(s: string): string {
  return s.replace(/<\/?[^>]+>/g, '');
}

export function useParsedVtt(url: string | null): VttCue[] {
  const [cues, setCues] = useState<VttCue[]>([]);
  useEffect(() => {
    setCues([]);
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setCues(parseVtt(text));
      })
      .catch(() => {
        if (!cancelled) setCues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return cues;
}

export function activeCueAt(cues: VttCue[], time: number): VttCue | null {
  // Linear scan — fine for typical 1-2k cue files.
  for (const c of cues) {
    if (time >= c.start && time <= c.end) return c;
  }
  return null;
}
