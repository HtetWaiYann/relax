import { useCallback, useState } from 'react';
import { APP_NAME } from '@relax/shared-utils';
import type { SearchResult } from '@relax/types';
import { relaxClient } from './lib/client';

type Status = 'idle' | 'loading' | 'success' | 'error';

export function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('inception');

  const onSearch = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await relaxClient.search({ query, pageSize: 10, page: 1 });
      setResults(res.results);
      setStatus('success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [query]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-10">
      <header className="mb-10">
        <h1 className="text-6xl font-black tracking-tighter bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
          {APP_NAME}
        </h1>
        <p className="mt-2 text-neutral-400">
          Desktop streaming for movie geeks · placeholder UI · proves the .proto → Go → TS pipeline.
        </p>
      </header>

      <section className="mb-8 flex gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a movie…"
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-neutral-100 placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
        />
        <button
          onClick={onSearch}
          disabled={status === 'loading'}
          className="rounded-lg bg-indigo-600 px-5 py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </section>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950 p-4 text-red-200">
          <strong>RPC error:</strong> {error}
        </div>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((r, idx) => (
          <li
            key={`${r.metadata?.tmdbId ?? idx}`}
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">{r.metadata?.title}</h2>
              <span className="text-sm text-neutral-500">{r.metadata?.year}</span>
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-neutral-400">{r.metadata?.overview}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {r.metadata?.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
                >
                  {g}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {status === 'idle' && (
        <p className="text-neutral-500">Hit Search to fetch placeholder results from the backend.</p>
      )}
    </main>
  );
}
