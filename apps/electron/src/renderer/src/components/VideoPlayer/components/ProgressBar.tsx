import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { fmtTime } from '../utils/format';

// Click or grab-and-drag to scrub. While held, the thumb and played fill
// follow the pointer with a time label; the seek itself is committed once,
// on release — every intermediate seek would cost a range request (or a new
// ffmpeg pipe in remux mode).
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
  // Scrub position while held. The ref is what release commits — the last
  // pointermove may not have re-rendered yet when the capture is released.
  const [dragTime, setDragTime] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const dragging = dragTime !== null;

  const getSeekTime = (clientX: number) => {
    if (!ref.current || duration <= 0) return null;
    const rect = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  };
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const shownTime = dragTime ?? current;
  const tipTime = dragTime ?? hoverTime;

  const scrubTo = (t: number | null) => {
    if (t === null) return;
    dragRef.current = t;
    setDragTime(t);
  };
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Pointer capture keeps the drag alive when the cursor leaves the bar
    // (or the window) and is released automatically on pointerup.
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubTo(getSeekTime(e.clientX));
  };
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = getSeekTime(e.clientX);
    if (dragRef.current !== null) scrubTo(t);
    else setHoverTime(t);
  };
  // Fires after pointerup, pointercancel, or anything else that drops the
  // capture (e.g. controls hiding mid-drag) — one commit path for all.
  const handleLostCapture = () => {
    const t = dragRef.current;
    dragRef.current = null;
    setDragTime(null);
    if (t !== null) onSeek(t);
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shownTime)}
      aria-valuetext={fmtTime(shownTime)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onLostPointerCapture={handleLostCapture}
      onPointerLeave={() => setHoverTime(null)}
      // Taller hit area than the visible track so it's easy to grab.
      className={`group relative flex h-4 touch-none select-none items-center ${
        dragging ? 'cursor-grabbing' : 'cursor-pointer'
      }`}
    >
      <div
        className={`relative w-full rounded-full bg-white/15 transition-[height] duration-100 ${
          dragging ? 'h-2' : 'h-1.5 group-hover:h-2'
        }`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/25"
          style={{ width: `${pct(buffered)}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${
            dragging ? 'bg-accent' : 'bg-primary group-hover:bg-accent'
          }`}
          style={{ width: `${pct(shownTime)}%` }}
        />
        <div
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-black/60 transition-[opacity,transform] duration-100 ${
            dragging ? 'scale-125 opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          style={{ left: `${pct(shownTime)}%` }}
        />
      </div>
      {tipTime !== null && duration > 0 && (
        <div
          className={`pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 tabular-nums text-white ring-1 ring-white/10 ${
            dragging ? 'text-sm font-semibold' : 'text-xs'
          }`}
          style={{ left: `${pct(tipTime)}%` }}
        >
          {fmtTime(tipTime)}
        </div>
      )}
    </div>
  );
}
