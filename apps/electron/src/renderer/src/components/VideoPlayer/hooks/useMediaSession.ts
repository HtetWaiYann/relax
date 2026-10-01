import { useEffect, useRef, type RefObject } from 'react';

// OS media integration: media keys / headset buttons and the macOS Now
// Playing widget (title, poster, scrubbable position). Play/pause state is
// reported by Chromium from the <video> itself.
export function useMediaSession({
  videoRef,
  title,
  subtitle,
  posterUrl,
  displayTime,
  duration,
  rate,
  seekTo,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  title: string;
  subtitle: string | undefined;
  posterUrl: string | undefined;
  displayTime: number;
  duration: number;
  rate: number;
  seekTo: (t: number) => void;
}) {
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title,
      artist: subtitle ?? '',
      artwork: posterUrl ? [{ src: posterUrl }] : [],
    });
    return () => { ms.metadata = null; };
  }, [title, subtitle, posterUrl]);

  // Handlers read the time through a ref so they aren't re-registered on
  // every timeupdate.
  const timeRef = useRef(displayTime);
  useEffect(() => { timeRef.current = displayTime; }, [displayTime]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => void videoRef.current?.play()],
      ['pause', () => videoRef.current?.pause()],
      ['seekbackward', (d) => seekTo(timeRef.current - (d.seekOffset ?? 10))],
      ['seekforward', (d) => seekTo(timeRef.current + (d.seekOffset ?? 10))],
      ['seekto', (d) => { if (d.seekTime != null) seekTo(d.seekTime); }],
    ];
    // setActionHandler throws for actions the platform doesn't support.
    for (const [action, handler] of handlers) {
      try { ms.setActionHandler(action, handler); } catch { /* unsupported */ }
    }
    return () => {
      for (const [action] of handlers) {
        try { ms.setActionHandler(action, null); } catch { /* unsupported */ }
      }
    };
  }, [videoRef, seekTo]);

  // Remux mode: the element only knows the current pipe's local time, so
  // report the real position/duration ourselves.
  useEffect(() => {
    if (!('mediaSession' in navigator) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(Math.max(0, displayTime), duration),
        playbackRate: rate,
      });
    } catch { /* invalid state mid-seek — the next tick corrects it */ }
  }, [displayTime, duration, rate]);
}
