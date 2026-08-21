import { useEffect, useRef, useState, type RefObject } from 'react';
import { type PanelKind } from '../types';

// Mouse-wheel volume with a transient HUD. Needs a non-passive listener —
// React's synthetic onWheel is passive and can't preventDefault the page
// scroll. Accumulator-based throttle: trackpads emit many tiny deltaY events;
// sum them and only tick once per WHEEL_THRESHOLD of accumulated scroll.
export function useWheelVolume({
  containerRef,
  videoRef,
  panel,
  wake,
}: {
  containerRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  panel: PanelKind;
  wake: () => void;
}) {
  // Transient HUD shown when the user scrolls to change volume.
  const [volumeHud, setVolumeHud] = useState<number | null>(null);
  const volumeHudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (volumeHudTimer.current) clearTimeout(volumeHudTimer.current);
  }, []);

  const wheelAccumRef = useRef(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const WHEEL_THRESHOLD = 40;
    const STEP = 0.02;
    const onWheel = (e: WheelEvent) => {
      // A popup (subs / audio / speed / stats) is open — let the panel's own
      // overflow-y-auto handle the scroll instead of hijacking it for volume.
      if (panel !== 'none') return;
      e.preventDefault();
      const v = videoRef.current;
      if (!v) return;
      wheelAccumRef.current += e.deltaY;
      const ticks = Math.trunc(wheelAccumRef.current / WHEEL_THRESHOLD);
      if (ticks === 0) return;
      wheelAccumRef.current -= ticks * WHEEL_THRESHOLD;
      const next = Math.max(0, Math.min(1, v.volume - ticks * STEP));
      v.volume = next;
      v.muted = next === 0;
      setVolumeHud(next);
      if (volumeHudTimer.current) clearTimeout(volumeHudTimer.current);
      volumeHudTimer.current = setTimeout(() => setVolumeHud(null), 900);
      wake();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef, videoRef, wake, panel]);

  return { volumeHud };
}
