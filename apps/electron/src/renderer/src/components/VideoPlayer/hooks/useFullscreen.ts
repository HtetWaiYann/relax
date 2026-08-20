import { useCallback, useEffect, useState, type RefObject } from 'react';

// Fullscreen state for the given container element, kept in sync with the
// document's fullscreenchange events.
export function useFullscreen(containerRef: RefObject<HTMLElement | null>) {
  const [fullscreen, setFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current.requestFullscreen();
  }, [containerRef]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  return { fullscreen, toggleFullscreen };
}
