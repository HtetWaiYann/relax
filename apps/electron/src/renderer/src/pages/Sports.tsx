import { Link } from 'react-router-dom';
import { MatchStatus, type Match, type Team } from '@relax/types';
import { useTodayMatches } from '../lib/queries';

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

export function Sports() {
  const { data, isLoading, error } = useTodayMatches();

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
      <header>
        <h1 className="text-2xl font-semibold text-neutral-100">Sports</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Today's matches ·{' '}
          {new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </header>

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
          No matches today.
        </p>
      ) : (
        [...groups].map(([competition, list]) => (
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
        ))
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
