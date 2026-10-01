import { useEffect, useRef, type RefObject } from 'react';
import { SPEEDS } from '../types';

// ponytail: no frame-rate metadata on <video>; 1/24s is a frame for film
// content and close enough for 25/30fps. Read it from requestVideoFrameCallback
// metadata if per-frame accuracy ever matters.
const FRAME_S = 1 / 24;
const SUB_DELAY_STEP_MS = 100;

interface ShortcutArgs {
  videoRef: RefObject<HTMLVideoElement | null>;
  seekTo: (t: number) => void;
  togglePlay: () => void;
  toggleFullscreen: () => void;
  displayTime: number;
  duration: number;
  rate: number;
  setPlaybackRate: (r: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  toggleSubtitles: () => void;
  subOffsetMs: number;
  setSubOffsetMs: (ms: number) => void;
  needsRemux: boolean;
  showToast: (msg: string) => void;
}

// Global keyboard shortcuts for the player:
//   ←/→ ±10s · ↑/↓ volume · space/k play · m mute · f fullscreen
//   c subtitles on/off · 0–9 jump to 0–90% · [ / ] speed
//   g / h subtitle delay −/+100ms · , / . frame step (paused, passthrough)
// One listener for the player's lifetime; it reads the latest values through
// a ref instead of re-subscribing on every timeupdate.
// ponytail: keyboard shortcuts never wake the controls — mouse-only. Changes
// with no visible control (speed, subtitle delay) confirm with a toast.
export function useKeyboardShortcuts(args: ShortcutArgs) {
  const argsRef = useRef(args);
  useEffect(() => { argsRef.current = args; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = argsRef.current;
      const v = a.videoRef.current;
      if (!v) return;
      // Leave Cmd/Ctrl/Alt combos (copy, find, devtools…) to the app/OS.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Arrows always seek — even with a button focused — so the player
      // doesn't fight focus-driven keyboard navigation. Other shortcuts still
      // defer to input/select focus.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        a.seekTo(a.displayTime + (e.key === 'ArrowRight' ? 10 : -10));
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (/^[0-9]$/.test(e.key)) {
        if (a.duration > 0) a.seekTo((a.duration * Number(e.key)) / 10);
        return;
      }
      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          a.togglePlay();
          break;
        case 'arrowup':
          e.preventDefault();
          v.volume = Math.min(1, v.volume + 0.05);
          a.setVolume(v.volume);
          break;
        case 'arrowdown':
          e.preventDefault();
          v.volume = Math.max(0, v.volume - 0.05);
          a.setVolume(v.volume);
          break;
        case 'm':
          v.muted = !v.muted;
          a.setMuted(v.muted);
          break;
        case 'f':
          a.toggleFullscreen();
          break;
        case 'c':
          a.toggleSubtitles();
          break;
        case '[':
        case ']': {
          const i = nearestSpeedIndex(a.rate);
          const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + (e.key === ']' ? 1 : -1)))];
          a.setPlaybackRate(next);
          a.showToast(`Speed ${next}×`);
          break;
        }
        case 'g':
        case 'h': {
          const next = a.subOffsetMs + (e.key.toLowerCase() === 'h' ? SUB_DELAY_STEP_MS : -SUB_DELAY_STEP_MS);
          a.setSubOffsetMs(next);
          a.showToast(`Subtitle delay ${next >= 0 ? '+' : ''}${(next / 1000).toFixed(1)}s`);
          break;
        }
        case ',':
        case '.':
          // Remux seeks restart the ffmpeg pipe — far too heavy per frame.
          if (a.needsRemux) return;
          v.pause();
          v.currentTime = Math.max(0, v.currentTime + (e.key === '.' ? FRAME_S : -FRAME_S));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function nearestSpeedIndex(rate: number): number {
  let best = 0;
  SPEEDS.forEach((s, i) => {
    if (Math.abs(s - rate) < Math.abs(SPEEDS[best] - rate)) best = i;
  });
  return best;
}
