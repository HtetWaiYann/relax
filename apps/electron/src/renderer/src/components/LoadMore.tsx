import { useEffect, useRef } from 'react';

interface LoadMoreProps {
  onIntersect: () => void;
  enabled: boolean;
}

// Invisible sentinel that fires onIntersect once it scrolls into view.
// Uses rootMargin so the next page is requested before the user actually
// hits the bottom.
export function LoadMore({ onIntersect, enabled }: LoadMoreProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onIntersect);
  cb.current = onIntersect;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) cb.current();
      },
      { rootMargin: '600px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled]);

  return <div ref={ref} aria-hidden className="h-1 w-full" />;
}
