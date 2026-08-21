import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { fmtTime } from '../utils/format';

export function ProgressBar({
  current,
  duration,
  buffered,
  onSeek,
}: {
  current: number;
  duration: number;
  buffered: number;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const playedPct = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const getSeekTime = (clientX: number) => {
    if (!ref.current || duration <= 0) return null;
    const rect = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  };
  // ponytail: AbortController so a fullscreen toggle / unmount mid-drag still
  // cleans up the document-level mousemove/mouseup listeners.
  const dragAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => dragAbortRef.current?.abort(), []);
  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    dragAbortRef.current?.abort();
    const ctl = new AbortController();
    dragAbortRef.current = ctl;
    const t = getSeekTime(e.clientX);
    if (t !== null) onSeek(t);
    document.addEventListener(
      'mousemove',
      (ev) => { const tt = getSeekTime(ev.clientX); if (tt !== null) onSeek(tt); },
      { signal: ctl.signal },
    );
    document.addEventListener(
      'mouseup',
      () => { ctl.abort(); if (dragAbortRef.current === ctl) dragAbortRef.current = null; },
      { signal: ctl.signal },
    );
  };
  return (
    <div
      ref={ref}
      onMouseDown={handleMouseDown}
      onMouseMove={(e) => setHoverTime(getSeekTime(e.clientX))}
      onMouseLeave={() => setHoverTime(null)}
      className="group relative h-1.5 cursor-pointer rounded-full bg-white/15"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-white/25"
        style={{ width: `${bufferedPct}%` }}
      />
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-primary group-hover:bg-accent"
        style={{ width: `${playedPct}%` }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-accent opacity-0 ring-2 ring-black/60 transition group-hover:opacity-100"
        style={{ left: `${playedPct}%` }}
      />
      {hoverTime !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-xs tabular-nums text-white ring-1 ring-white/10"
          style={{ left: `${(hoverTime / duration) * 100}%` }}
        >
          {fmtTime(hoverTime)}
        </div>
      )}
    </div>
  );
}
