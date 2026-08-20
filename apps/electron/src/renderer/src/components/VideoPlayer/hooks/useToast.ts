import { useCallback, useEffect, useRef, useState } from 'react';

// Transient confirmation toast (subtitle loaded, subtitles off, etc.).
// Auto-dismisses after 3.5s; a new toast resets the timer.
export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);
  return { toast, setToast, showToast };
}
