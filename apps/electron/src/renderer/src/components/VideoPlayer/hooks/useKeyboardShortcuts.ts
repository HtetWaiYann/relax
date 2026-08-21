import { useEffect, type RefObject } from 'react';

// Global keyboard shortcuts for the player. Deps intentionally track only
// toggleFullscreen/seekTo/displayTime — togglePlay and the volume/mute setters
// are stable and were omitted in the original to avoid needless re-subscription.
export function useKeyboardShortcuts({
  videoRef,
  seekTo,
  togglePlay,
  toggleFullscreen,
  displayTime,
  setVolume,
  setMuted,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  seekTo: (t: number) => void;
  togglePlay: () => void;
  toggleFullscreen: () => void;
  displayTime: number;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      // Arrows always seek — even with a button focused — so the player
      // doesn't fight focus-driven keyboard navigation. Other shortcuts still
      // defer to input/select focus.
      // ponytail: keyboard shortcuts never wake the controls — mouse-only.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(displayTime + (e.key === 'ArrowRight' ? 10 : -10));
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowUp':
          e.preventDefault();
          v.volume = Math.min(1, v.volume + 0.05);
          setVolume(v.volume);
          break;
        case 'ArrowDown':
          e.preventDefault();
          v.volume = Math.max(0, v.volume - 0.05);
          setVolume(v.volume);
          break;
        case 'm':
          v.muted = !v.muted;
          setMuted(v.muted);
          break;
        case 'f':
          toggleFullscreen();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen, seekTo, displayTime]);
}
