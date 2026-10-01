import { useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { MatchStatus, type Match, type Team } from '@relax/types';
import { useMatchesOn } from '../lib/queries';

const STATUS_ORDER: Record<MatchStatus, number> = {
  [MatchStatus.LIVE]: 0,
  [MatchStatus.PAUSED]: 0,
  [MatchStatus.SCHEDULED]: 1,
  [MatchStatus.UNSPECIFIED]: 1,
  [MatchStatus.FINISHED]: 2,
  [MatchStatus.POSTPONED]: 3,
};

export const kickoffDate = (m: Match) => new Date(Number(m.kickoff?.seconds ?? 0n) * 1000);

export function StatusBadge({ match }: { match: Match }) {
  switch (match.status) {
    case MatchStatus.LIVE:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          LIVE
        </span>
      );
    case MatchStatus.PAUSED:
      return (
        <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
          HT
        </span>
      );
    case MatchStatus.FINISHED:
      return <span className="text-xs font-medium text-neutral-500">FT</span>;
    case MatchStatus.POSTPONED:
      return <span className="text-xs font-medium text-neutral-500">Postponed</span>;
    default:
      return (
        <span className="text-xs font-medium text-neutral-300">
          {kickoffDate(match).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      );
  }
}

export function Crest({ team, className }: { team?: Team; className: string }) {
  return team?.crestUrl ? (
    <img src={team.crestUrl} alt="" className={`${className} object-contain`} loading="lazy" />
  ) : (
    <span className={`${className} rounded-full bg-white/10`} />
  );
}

const DAY_MS = 86_400_000;
const STRIP_RADIUS = 3; // days shown either side of the selected one

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Local YYYY-MM-DD (toISOString would shift to UTC).
const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = (k: string | null) => {
  const m = k?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : startOfDay(new Date());
};

function relativeLabel(day: Date): string | null {
  const diff = Math.round((day.getTime() - startOfDay(new Date()).getTime()) / DAY_MS);
  return diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : diff === 1 ? 'Tomorrow' : null;
}

function DateStrip({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const today = startOfDay(new Date());
  const days = Array.from({ length: STRIP_RADIUS * 2 + 1 }, (_, i) =>
    addDays(value, i - STRIP_RADIUS),
  );
  const arrow =
    'grid h-14 w-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100';

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(addDays(value, -1))}
        aria-label="Previous day"
        className={arrow}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="grid flex-1 grid-cols-7 gap-1">
        {days.map((d) => {
          const selected = d.getTime() === value.getTime();
          const isToday = d.getTime() === today.getTime();
          return (
            <button
              key={toKey(d)}
              type="button"
              onClick={() => onChange(d)}
              aria-pressed={selected}
              className={[
                'relative flex h-14 flex-col items-center justify-center rounded-lg text-xs transition',
                selected
                  ? 'bg-accent text-surface'
                  : 'text-neutral-400 hover:bg-white/10 hover:text-neutral-100',
              ].join(' ')}
            >
              <span className="font-medium">
                {relativeLabel(d) ?? d.toLocaleDateString([], { weekday: 'short' })}
              </span>
              <span className={selected ? 'font-semibold' : 'text-neutral-500'}>
                {d.toLocaleDateString([], { day: 'numeric', month: 'short' })}
              </span>
              {isToday && !selected && (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onChange(addDays(value, 1))}
        aria-label="Next day"
        className={arrow}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {/* Native picker for jumping further than the strip; the input stays invisible. */}
      <button
        type="button"
        onClick={() => inputRef.current?.showPicker()}
        aria-label="Pick a date"
        title="Pick a date"
        className={`${arrow} relative w-10`}
      >
        <CalendarDays className="h-4 w-4" />
        <input
          ref={inputRef}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={toKey(value)}
          onChange={(e) => e.target.value && onChange(fromKey(e.target.value))}
          className="pointer-events-none absolute inset-0 opacity-0"
        />
      </button>
    </div>
  );
}

export function Sports() {
  const [params, setParams] = useSearchParams();
  const day = fromKey(params.get('date'));
  const isToday = relativeLabel(day) === 'Today';
  const setDay = (d: Date) =>
    setParams(relativeLabel(d) === 'Today' ? {} : { date: toKey(d) }, { replace: true });
  const { data, isLoading, error, refetch, isFetching, isPlaceholderData, dataUpdatedAt } =
    useMatchesOn(day);

  const matches = [...(data?.matches ?? [])].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      kickoffDate(a).getTime() - kickoffDate(b).getTime(),
  );
  const groups = new Map<string, Match[]>();
  for (const m of matches) {
    const key = m.competition?.name ?? 'Other';
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Sports</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {relativeLabel(day) ? `${relativeLabel(day)} · ` : ''}
            {day.toLocaleDateString([], {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isToday && (
            <button
              type="button"
              onClick={() => setDay(startOfDay(new Date()))}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-neutral-300 ring-1 ring-border-subtle transition hover:text-neutral-100"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            title={
              dataUpdatedAt ? `Updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : undefined
            }
            className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-sm font-medium text-neutral-200 ring-1 ring-border-subtle transition hover:bg-white/10 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
            {dataUpdatedAt > 0 && (
              <span className="text-xs font-normal text-neutral-500 tabular-nums">
                {new Date(dataUpdatedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </button>
        </div>
      </header>

      <DateStrip value={day} onChange={setDay} />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-elevated/60" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-xl bg-surface-elevated/70 px-4 py-6 text-sm text-neutral-400 ring-1 ring-border-subtle/60">
          Couldn't load fixtures: {error.message}
        </p>
      ) : groups.size === 0 ? (
        <p className="rounded-xl bg-surface-elevated/70 px-4 py-6 text-sm text-neutral-400 ring-1 ring-border-subtle/60">
          No matches{' '}
          {isToday
            ? 'today'
            : `on ${day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}`}
          .
        </p>
      ) : (
        // Previous day stays visible (dimmed) while the newly picked one loads.
        <div className={`space-y-6 transition-opacity ${isPlaceholderData ? 'opacity-40' : ''}`}>
          {[...groups].map(([competition, list]) => (
            <section key={competition} className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-300">
                {list[0]?.competition?.emblemUrl && (
                  <img
                    src={list[0].competition.emblemUrl}
                    alt=""
                    className="h-5 w-5 object-contain"
                  />
                )}
                {competition}
              </h2>
              <ul className="divide-y divide-border-subtle/40 overflow-hidden rounded-xl bg-surface-elevated/70 ring-1 ring-border-subtle/60">
                {list.map((m) => (
                  <li key={m.id}>
                    <MatchRow match={m} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchRow({ match }: { match: Match }) {
  return (
    <Link
      to={`/sports/${match.id}`}
      className="grid grid-cols-[5rem_1fr_auto_1fr] items-center gap-4 px-4 py-3 transition hover:bg-white/5"
    >
      <StatusBadge match={match} />
      <span className="flex items-center justify-end gap-2 text-right text-sm text-neutral-100">
        {match.home?.shortName || match.home?.name}
        <Crest team={match.home} className="h-6 w-6" />
      </span>
      <span className="min-w-12 text-center text-sm font-semibold tabular-nums text-neutral-100">
        {match.hasScore ? `${match.homeScore} – ${match.awayScore}` : 'vs'}
      </span>
      <span className="flex items-center gap-2 text-sm text-neutral-100">
        <Crest team={match.away} className="h-6 w-6" />
        {match.away?.shortName || match.away?.name}
      </span>
    </Link>
  );
}
