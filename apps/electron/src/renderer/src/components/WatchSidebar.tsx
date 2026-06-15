import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, Check, ChevronRight, Download } from 'lucide-react';
import { MediaType, type MediaDetail, type SeasonInfo, type StreamSource } from '@relax/types';
import { useStreams } from '../lib/queries';
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
  if (!summary) return null;
  const isTV = summary.mediaType === MediaType.TV;

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
          className="rounded-full p-1.5 text-neutral-400 transition hover:bg-surface-muted hover:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-accent/40"
          aria-label="Close watch panel"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {isTV ? (
        <SeriesPanel detail={detail} />
      ) : (
        <MoviePanel tmdbId={summary.tmdbId} />
      )}
    </aside>
  );
}

function MoviePanel({ tmdbId }: { tmdbId: number }) {
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
      <StreamsList isLoading={isLoading} error={error} streams={filtered} />
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

function SeriesPanel({ detail }: { detail: MediaDetail }) {
  const seasons = (detail.seasons ?? []) as SeasonInfo[];
  const tmdbId = detail.summary?.tmdbId ?? 0;

  const initialSeason = seasons[0]?.seasonNumber ?? 1;
  const [season, setSeason] = useState<number>(initialSeason);
  const [episode, setEpisode] = useState<number>(1);

  useEffect(() => {
    setSeason(initialSeason);
    setEpisode(1);
  }, [initialSeason]);

  const current = seasons.find((s) => s.seasonNumber === season);
  const episodeCount = current?.episodeCount ?? 0;
  const episodes = useMemo(
    () => Array.from({ length: episodeCount }, (_, i) => i + 1),
    [episodeCount],
  );

  const { data, isLoading, error } = useStreams(MediaType.TV, tmdbId, season, episode);
  const streams = data?.streams ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {seasons.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-3">
          {seasons.map((s) => (
            <FilterPill
              key={s.seasonNumber}
              active={s.seasonNumber === season}
              onClick={() => {
                setSeason(s.seasonNumber);
                setEpisode(1);
              }}
            >
              Season {s.seasonNumber}
            </FilterPill>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {episodes.length === 0 ? (
          <div className="px-2 py-6 text-xs text-neutral-500">No episodes listed.</div>
        ) : (
          <ul className="space-y-1.5">
            {episodes.map((ep) => {
              const active = ep === episode;
              return (
                <li key={ep}>
                  <button
                    type="button"
                    onClick={() => setEpisode(ep)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                      active
                        ? 'bg-primary/15 ring-1 ring-primary/40'
                        : 'hover:bg-surface-muted/60'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        active
                          ? 'bg-primary text-white'
                          : 'bg-surface-muted text-neutral-300'
                      }`}
                    >
                      {ep < episode ? <Check className="h-3.5 w-3.5" /> : ep}
                    </span>
                    <span className="flex-1 truncate text-sm text-neutral-100">
                      Episode {ep}
                    </span>
                    {active && <ChevronRight className="h-4 w-4 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border-subtle">
        <div className="px-5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Sources · S{season} E{episode}
        </div>
        <StreamsList isLoading={isLoading} error={error} streams={streams} maxHeight />
      </div>
    </div>
  );
}

function StreamsList({
  isLoading,
  error,
  streams,
  maxHeight,
}: {
  isLoading: boolean;
  error: unknown;
  streams: StreamSource[];
  maxHeight?: boolean;
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
      {streams.map((s) => (
        <StreamSourceCard
          key={`${s.infoHash}-${s.fileIdx}`}
          stream={s}
          // eslint-disable-next-line no-undef
          onSelect={(stream) => console.log('selected stream', stream)}
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
      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
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
