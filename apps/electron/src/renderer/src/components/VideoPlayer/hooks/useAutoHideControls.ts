import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { HIDE_DELAY_MS } from '../types';

// Auto-hide controls. Hide while playing OR while buffering (no video yet);
// keep them visible only when the user has explicitly paused. `wake` is called
// on mouse move / wheel / mount to re-show and restart the hide timer.
export function useAutoHideControls(videoRef: RefObject<HTMLVideoElement | null>) {
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wake = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (!v || !v.paused) setShowControls(false);
    }, HIDE_DELAY_MS);
  }, [videoRef]);

  useEffect(() => {
    wake();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [wake]);

  return { showControls, setShowControls, wake };
}
