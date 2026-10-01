import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Play, RefreshCw } from 'lucide-react';
import { useMatchStreams } from '../lib/queries';
import { Crest, StatusBadge, kickoffDate } from './Sports';
import type { LiveState } from './LiveWatch';

export function Match() {
  const navigate = useNavigate();
  const matchId = Number(useParams<{ id: string }>().id) || 0;
  const { data, isLoading, error, refetch, isFetching } = useMatchStreams(matchId);
  const match = data?.match;
  const streams = data?.streams ?? [];
  const title = match ? `${match.home?.name} vs ${match.away?.name}` : '';

  const play = (index: number) => {
    const state: LiveState = {
      title,
      index,
      streams: streams.map(({ name, title, playUrl }) => ({ name, title, playUrl })),
    };
    navigate('/live', { state });
  };

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/sports'))}
        className="inline-flex items-center gap-1.5 text-sm text-neutral-400 transition hover:text-neutral-100"
      >
        <ArrowLeft className="h-4 w-4" /> Sports
      </button>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-elevated/60" />
      ) : error || !match ? (
        <p className="text-sm text-neutral-400">
          Couldn't load match: {error?.message ?? 'not found'}
        </p>
      ) : (
        <>
          <header className="rounded-2xl bg-surface-elevated/70 px-6 py-8 ring-1 ring-border-subtle/60">
            <p className="text-center text-xs font-medium tracking-wide text-neutral-500 uppercase">
              {match.competition?.name} ·{' '}
              {kickoffDate(match).toLocaleString([], {
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <Crest team={match.home} className="h-16 w-16" />
                <span className="text-base font-semibold text-neutral-100">{match.home?.name}</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="text-4xl font-bold tabular-nums text-neutral-100">
                  {match.hasScore ? `${match.homeScore} – ${match.awayScore}` : 'vs'}
                </span>
                <StatusBadge match={match} />
              </div>
              <div className="flex flex-col items-center gap-2 text-center">
                <Crest team={match.away} className="h-16 w-16" />
                <span className="text-base font-semibold text-neutral-100">{match.away?.name}</span>
              </div>
            </div>
          </header>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-100">Streams</h2>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Retry
              </button>
            </div>

            {!data.sourceConfigured ? (
              <p className="text-sm text-neutral-400">
                No stream source configured. Set{' '}
                <code className="text-neutral-300">SPORTS_ADDON_URL</code> in the backend{' '}
                <code className="text-neutral-300">.env</code>.
              </p>
            ) : streams.length === 0 ? (
              <p className="text-sm text-neutral-400">
                No streams found yet. They usually appear close to kickoff.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {streams.map((s, i) => (
                  <li key={s.playUrl}>
                    <button
                      type="button"
                      onClick={() => play(i)}
                      className="flex w-full items-center gap-3 rounded-xl bg-surface-elevated/70 px-4 py-3 text-left ring-1 ring-border-subtle/60 transition hover:bg-surface-elevated"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-surface">
                        <Play className="h-4 w-4 fill-current" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-neutral-100">
                          {s.name || `Stream ${i + 1}`}
                        </span>
                        {s.title && (
                          <span className="block truncate text-xs text-neutral-500">{s.title}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
