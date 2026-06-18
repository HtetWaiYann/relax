import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronRight, ChevronLeft, ChevronDown, Download, Info } from 'lucide-react';
import { MediaType, type MediaDetail, type SeasonInfo, type StreamSource } from '@relax/types';
import { useStreams } from '../lib/queries';
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

  const launch = (stream: StreamSource, seasonEp?: { season: number; episode: number }) => {
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

function SeriesPanel({
  detail,
  onLaunch,
}: {
  detail: MediaDetail;
  onLaunch: (s: StreamSource, seasonEp: { season: number; episode: number }) => void;
}) {
  const seasons = (detail.seasons ?? []) as SeasonInfo[];
  const tmdbId = detail.summary?.tmdbId ?? 0;
  const initialSeason = seasons[0]?.seasonNumber ?? 1;

  const [season, setSeason] = useState<number>(initialSeason);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);

  const current = seasons.find((s) => s.seasonNumber === season);
  const episodeCount = current?.episodeCount ?? 0;
  const episodes = useMemo(
    () => Array.from({ length: episodeCount }, (_, i) => i + 1),
    [episodeCount],
  );

  if (selectedEpisode !== null) {
    return (
      <SeriesSourcesView
        tmdbId={tmdbId}
        season={season}
        episode={selectedEpisode}
        onBack={() => setSelectedEpisode(null)}
        onLaunch={(s) => onLaunch(s, { season, episode: selectedEpisode })}
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
        {episodes.length === 0 ? (
          <div className="px-2 py-6 text-xs text-neutral-500">No episodes listed.</div>
        ) : (
          <ul className="space-y-1.5">
            {episodes.map((ep) => (
              <li key={ep}>
                <button
                  type="button"
                  onClick={() => setSelectedEpisode(ep)}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-muted/60"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-neutral-300 group-hover:bg-primary group-hover:text-white">
                    {ep}
                  </span>
                  <span className="flex-1 truncate text-sm text-neutral-100">
                    Episode {ep}
                  </span>
                  <ChevronRight className="h-4 w-4 text-neutral-500 group-hover:text-accent" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
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
  episode: number;
  onBack: () => void;
  onLaunch: (s: StreamSource) => void;
}) {
  const { data, isLoading, error } = useStreams(MediaType.TV, tmdbId, season, episode);
  const streams = data?.streams ?? [];

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
      <div className="px-5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        Sources · S{season} E{episode}
      </div>
      <StreamsList isLoading={isLoading} error={error} streams={streams} onLaunch={onLaunch} />
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
