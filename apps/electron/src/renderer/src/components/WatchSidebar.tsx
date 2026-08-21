import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronRight, ChevronLeft, ChevronDown, Download, Info, Check } from 'lucide-react';
import {
  MediaType,
  type MediaDetail,
  type SeasonInfo,
  type StreamSource,
  type WatchProgress,
} from '@relax/types';
import { useSeasonEpisodes, useSeriesProgress, useStreams } from '../lib/queries';
import { buildMagnet } from '../lib/torrent';
import type { WatchState } from '../pages/Watch';
import { StreamSourceCard } from './StreamSourceCard';
import { Skeleton } from './Skeleton';

interface WatchSidebarProps {
  detail: MediaDetail;
  onClose: () => void;
}

const QUALITY_FILTERS = ['All', '4K', '1080p', '720p'] as const;
type QualityFilter = (typeof QUALITY_FILTERS)[number];

export function WatchSidebar({ detail, onClose }: WatchSidebarProps) {
  const summary = detail.summary;
  const navigate = useNavigate();
  if (!summary) return null;
  const isTV = summary.mediaType === MediaType.TV;

  const launch = (
    stream: StreamSource,
    seasonEp?: { season: number; episode: number },
    resumeSeconds?: number,
  ) => {
    const state: WatchState = {
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx,
      magnetUri: buildMagnet(stream.infoHash, stream.title || summary.title),
      title: summary.title,
      subtitle: seasonEp ? `S${seasonEp.season} · E${seasonEp.episode}` : stream.title,
      quality: stream.quality,
      sourceLabel: stream.sourceName,
      tmdbId: summary.tmdbId,
      mediaType: summary.mediaType,
      season: seasonEp?.season ?? 0,
      episode: seasonEp?.episode ?? 0,
      resumeSeconds: resumeSeconds && resumeSeconds > 0 ? resumeSeconds : undefined,
      posterUrl: summary.posterUrl,
    };
    navigate(`/watch/${stream.infoHash}`, { state });
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-border-subtle bg-surface-elevated/40">
      <header className="flex items-start justify-between gap-3 px-5 py-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            {isTV ? 'Select Episode' : 'Torrent Sources'}
          </div>
          <div className="mt-0.5 text-base font-semibold text-neutral-100">{summary.title}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-full p-1.5 text-neutral-400 transition hover:bg-surface-muted hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="Close watch panel"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {isTV ? (
        <SeriesPanel detail={detail} onLaunch={launch} />
      ) : (
        <MoviePanel tmdbId={summary.tmdbId} onLaunch={launch} />
      )}
    </aside>
  );
}

function MoviePanel({
  tmdbId,
  onLaunch,
}: {
  tmdbId: number;
  onLaunch: (s: StreamSource) => void;
}) {
  const [filter, setFilter] = useState<QualityFilter>('All');
  const { data, isLoading, error } = useStreams(MediaType.MOVIE, tmdbId);
  const streams = data?.streams ?? [];
  const filtered = useMemo(() => filterByQuality(streams, filter), [streams, filter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 px-5 pb-3">
        {QUALITY_FILTERS.map((q) => (
          <FilterPill key={q} active={q === filter} onClick={() => setFilter(q)}>
            {q}
          </FilterPill>
        ))}
      </div>
      <StreamsList isLoading={isLoading} error={error} streams={filtered} onLaunch={onLaunch} />
      <footer className="border-t border-border-subtle px-5 py-3">
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 rounded-md bg-surface-muted/60 px-3 py-2.5 text-xs font-medium text-neutral-500"
        >
          <Download className="h-4 w-4" />
          Download Instead
        </button>
      </footer>
    </div>
  );
}

// FINISHED_RATIO mirrors backend storage.FinishedRatio — a progress row at or
// past this fraction counts as fully watched (✓), below it as in-progress.
const FINISHED_RATIO = 0.97;

type EpisodeRow = {
  number: number;
  name: string;
  overview: string;
  still: string;
  airDate: string;
};

function SeriesPanel({
  detail,
  onLaunch,
}: {
  detail: MediaDetail;
  onLaunch: (
    s: StreamSource,
    seasonEp: { season: number; episode: number },
    resumeSeconds?: number,
  ) => void;
}) {
  const seasons = (detail.seasons ?? []) as SeasonInfo[];
  const tmdbId = detail.summary?.tmdbId ?? 0;

  const progressQuery = useSeriesProgress(tmdbId, MediaType.TV);
  // ListByMedia orders by last_watched_at DESC, so item[0] is the last watched.
  const lastWatched = progressQuery.data?.items?.[0];
  const progress = useMemo(() => {
    const map = new Map<string, WatchProgress>();
    for (const p of progressQuery.data?.items ?? []) {
      map.set(`${p.season}-${p.episode}`, p);
    }
    return map;
  }, [progressQuery.data]);

  const [season, setSeason] = useState<number>(seasons[0]?.seasonNumber ?? 1);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);

  // Adopt the last-watched season once progress resolves (query loads empty).
  const preselected = useRef(false);
  useEffect(() => {
    if (!preselected.current && lastWatched?.season) {
      preselected.current = true;
      setSeason(lastWatched.season);
    }
  }, [lastWatched]);

  const episodesQuery = useSeasonEpisodes(tmdbId, season);
  const rows: EpisodeRow[] = useMemo(() => {
    const eps = episodesQuery.data?.episodes ?? [];
    if (eps.length > 0) {
      return eps.map((e) => ({
        number: e.episodeNumber,
        name: e.name,
        overview: e.overview,
        still: e.stillUrl,
        airDate: e.airDate,
      }));
    }
    // Fallback to plain numbering if the episode fetch is empty/unavailable.
    const count = seasons.find((s) => s.seasonNumber === season)?.episodeCount ?? 0;
    return Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      name: '',
      overview: '',
      still: '',
      airDate: '',
    }));
  }, [episodesQuery.data, seasons, season]);

  // Scroll the last-watched episode of the visible season into view.
  const scrollRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (lastWatched?.season === season) {
      scrollRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [rows, season, lastWatched]);

  if (selectedEpisode !== null) {
    const row =
      rows.find((r) => r.number === selectedEpisode) ??
      ({ number: selectedEpisode, name: '', overview: '', still: '', airDate: '' } as EpisodeRow);
    return (
      <SeriesSourcesView
        tmdbId={tmdbId}
        season={season}
        episode={row}
        onBack={() => setSelectedEpisode(null)}
        onLaunch={(s) =>
          onLaunch(
            s,
            { season, episode: selectedEpisode },
            progress.get(`${season}-${selectedEpisode}`)?.positionSeconds,
          )
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {seasons.length > 0 && (
        <div className="px-5 pb-3">
          <div className="relative">
            <select
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              className="w-full appearance-none rounded-md border border-border-subtle bg-surface-muted/60 px-3 py-2 pr-9 text-sm text-neutral-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
            >
              {seasons.map((s) => (
                <option key={s.seasonNumber} value={s.seasonNumber}>
                  {s.name || `Season ${s.seasonNumber}`}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {episodesQuery.isLoading ? (
          <ul className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex gap-3 px-2 py-2">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <Skeleton className="h-14 w-24 shrink-0 rounded-md" />
                <div className="flex-1 space-y-1.5 py-1">
                  <Skeleton className="h-2.5 w-16 rounded" />
                  <Skeleton className="h-3 w-32 rounded" />
                </div>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="px-2 py-6 text-xs text-neutral-500">No episodes listed.</div>
        ) : (
          <ul className="space-y-1">
            {rows.map((ep) => {
              const p = progress.get(`${season}-${ep.number}`);
              const isLast = lastWatched?.season === season && lastWatched?.episode === ep.number;
              const released = isReleased(ep.airDate);
              return (
                <li key={ep.number} ref={isLast ? scrollRef : undefined}>
                  <button
                    type="button"
                    disabled={!released}
                    onClick={() => released && setSelectedEpisode(ep.number)}
                    title={released ? ep.overview || '' : 'Not released yet'}
                    className={`group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition ${
                      released
                        ? 'cursor-pointer hover:bg-surface-muted/60'
                        : 'cursor-not-allowed opacity-50'
                    }`}
                  >
                    <EpisodeStatus number={ep.number} progress={p} />
                    {ep.still ? (
                      <img
                        src={ep.still}
                        alt=""
                        loading="lazy"
                        onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                        className="h-14 w-24 shrink-0 rounded-md bg-surface-muted object-cover"
                      />
                    ) : (
                      <div className="h-14 w-24 shrink-0 rounded-md bg-surface-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                        Episode {ep.number}
                        {ep.airDate && ` · ${formatAirDate(ep.airDate)}`}
                      </div>
                      <div className="truncate text-sm font-medium text-neutral-100">
                        {ep.name || `Episode ${ep.number}`}
                      </div>
                      {ep.overview && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-neutral-400">{ep.overview}</p>
                      )}
                    </div>
                    {released ? (
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-neutral-500 group-hover:text-accent" />
                    ) : (
                      <span className="mt-0.5 shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                        Coming soon
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function EpisodeStatus({ number, progress }: { number: number; progress?: WatchProgress }) {
  const ratio =
    progress && progress.durationSeconds > 0
      ? progress.positionSeconds / progress.durationSeconds
      : 0;

  if (ratio >= FINISHED_RATIO) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
        <Check className="h-4 w-4" />
      </span>
    );
  }
  if (ratio > 0) {
    const pct = Math.max(8, Math.min(100, Math.round(ratio * 100)));
    return (
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-[2px]"
        style={{
          background: `conic-gradient(var(--color-accent) ${pct}%, var(--color-surface-muted) ${pct}%)`,
        }}
        title={`${pct}% watched`}
      >
        <span className="flex h-full w-full items-center justify-center rounded-full bg-surface-elevated text-xs font-semibold text-neutral-100">
          {number}
        </span>
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-neutral-300">
      {number}
    </span>
  );
}

// An episode is watchable once its air date has passed. Unknown/blank air
// dates are treated as released so we never block a legitimately-available ep.
function isReleased(airDate: string): boolean {
  if (!airDate) return true;
  const d = new Date(airDate);
  return Number.isNaN(d.getTime()) || d.getTime() <= Date.now();
}

function formatAirDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function SeriesSourcesView({
  tmdbId,
  season,
  episode,
  onBack,
  onLaunch,
}: {
  tmdbId: number;
  season: number;
  episode: EpisodeRow;
  onBack: () => void;
  onLaunch: (s: StreamSource) => void;
}) {
  const [filter, setFilter] = useState<QualityFilter>('All');
  const { data, isLoading, error } = useStreams(MediaType.TV, tmdbId, season, episode.number);
  const streams = data?.streams ?? [];
  const filtered = useMemo(() => filterByQuality(streams, filter), [streams, filter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mx-5 mb-2 flex cursor-pointer items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-medium text-neutral-300 transition hover:bg-surface-muted hover:text-neutral-100"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to episodes
      </button>

      <div className="flex gap-3 px-5 pt-4 pb-8">
        {episode.still ? (
          <img
            src={episode.still}
            alt=""
            onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
            className="h-16 w-28 shrink-0 rounded-md bg-surface-muted object-cover"
          />
        ) : (
          <div className="h-16 w-28 shrink-0 rounded-md bg-surface-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            S{season} · Episode {episode.number}
            {episode.airDate && ` · ${formatAirDate(episode.airDate)}`}
          </div>
          <div className="truncate text-sm font-semibold text-neutral-100">
            {episode.name || `Episode ${episode.number}`}
          </div>
          {/* {episode.overview && (
            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-neutral-400">
              {episode.overview}
            </p>
          )} */}
        </div>
      </div>

      <div className="flex gap-2 px-5 pb-2">
        {QUALITY_FILTERS.map((q) => (
          <FilterPill key={q} active={q === filter} onClick={() => setFilter(q)}>
            {q}
          </FilterPill>
        ))}
      </div>

      <StreamsList isLoading={isLoading} error={error} streams={filtered} onLaunch={onLaunch} />
    </div>
  );
}

function StreamsList({
  isLoading,
  error,
  streams,
  maxHeight,
  onLaunch,
}: {
  isLoading: boolean;
  error: unknown;
  streams: StreamSource[];
  maxHeight?: boolean;
  onLaunch: (s: StreamSource) => void;
}) {
  const container = `space-y-2.5 px-5 py-3 ${
    maxHeight ? 'max-h-[42vh] overflow-y-auto' : 'min-h-0 flex-1 overflow-y-auto'
  }`;

  if (isLoading) {
    return (
      <div className={container}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className={container}>
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-200">
          Couldn't load streams. Try again in a moment.
        </div>
      </div>
    );
  }
  if (streams.length === 0) {
    return (
      <div className={container}>
        <div className="rounded-lg border border-dashed border-border-subtle px-3 py-6 text-center text-xs text-neutral-500">
          No streams found.
        </div>
      </div>
    );
  }
  return (
    <div className={container}>
      <div className="flex items-start gap-2 rounded-lg border border-border-subtle/60 bg-surface-muted/40 px-3 py-2 text-xs text-neutral-400 mb-6">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500" />
        <p>
          More seeders usually help, but they're not guaranteed. If playback fails, try another stream.
        </p>
      </div>
      {streams.map((s, i) => (
        <StreamSourceCard
          key={`${s.infoHash}-${s.fileIdx}-${i}`}
          stream={s}
          onSelect={onLaunch}
        />
      ))}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? 'bg-primary text-white'
          : 'bg-surface-muted/60 text-neutral-300 hover:bg-surface-muted'
      }`}
    >
      {children}
    </button>
  );
}

function filterByQuality(streams: StreamSource[], filter: QualityFilter): StreamSource[] {
  if (filter === 'All') return streams;
  const target = filter.toLowerCase();
  return streams.filter((s) => s.quality.toLowerCase() === target);
}
