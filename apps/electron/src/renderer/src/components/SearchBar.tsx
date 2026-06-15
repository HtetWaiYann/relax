import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';

const DEBOUNCE_MS = 300;

export function SearchBar() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [value, setValue] = useState(initial);

  // Keep the input in sync with the route's ?q= when navigation happens externally.
  useEffect(() => {
    setValue(initial);
  }, [initial]);

  useEffect(() => {
    const trimmed = value.trim();
    const handle = setTimeout(() => {
      if (trimmed.length === 0) {
        // ponytail: typing back to empty just stays on /search with empty results;
        // navigating home would steal focus from the input.
        return;
      }
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value, navigate]);

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            navigate(`/search?q=${encodeURIComponent(value.trim())}`);
          }
        }}
        placeholder="Search movies, series…"
        className="h-9 w-full rounded-full border border-border-subtle bg-surface-elevated pl-9 pr-4 text-sm text-neutral-100 placeholder-neutral-500 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
    </div>
  );
}
