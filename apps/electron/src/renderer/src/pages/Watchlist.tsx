import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bookmark,
  ChevronDown,
  LayoutGrid,
  List as ListIcon,
  Star,
  X,
} from 'lucide-react';
import type { WatchlistItem } from '@relax/types';
import {
  mediaTypeToRoute,
  useInfiniteWatchlist,
  useRemoveFromWatchlist,
  type WatchlistSortKey,
} from '../lib/queries';
import { PosterCardSkeleton } from '../components/Skeleton';

type Filter = 'all' | 'movie' | 'tv';
type View = 'grid' | 'list';

const SORT_LABELS: Record<WatchlistSortKey, string> = {
  added_at: 'Recently Added',
  title_asc: 'Title A–Z',
  title_desc: 'Title Z–A',
  rating: 'Highest Rated',
};

export function Watchlist() {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<WatchlistSortKey>('added_at');
  const [view, setView] = useState<View>('grid');

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteWatchlist(sort, filter);

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const total = data?.pages[0]?.totalCount ?? 0;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, sort, filter]);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">My Watchlist</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {total > 0 ? `${total} ${total === 1 ? 'title' : 'titles'}` : 'No titles yet'}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle/60 pb-3">
        <FilterTabs value={filter} onChange={setFilter} />
        <div className="flex items-center gap-2">
          <SortDropdown value={sort} onChange={setSort} />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <PosterCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState filter={filter} />
      ) : view === 'grid' ? (
        <WatchlistGrid items={items} />
      ) : (
        <WatchlistList items={items} />
      )}

      <div ref={sentinelRef} className="h-1" />
      {isFetchingNextPage && (
        <div className="py-4 text-center text-xs text-neutral-500">Loading more…</div>
      )}
    </div>
  );
}

function FilterTabs({ value, onChange }: { value: Filter; onChange: (v: Filter) => void }) {
  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'movie', label: 'Movies' },
    { key: 'tv', label: 'Series' },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg bg-surface-elevated/60 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={
            value === t.key
              ? 'cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white'
              : 'cursor-pointer rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:text-neutral-100'
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SortDropdown({
  value,
  onChange,
}: {
  value: WatchlistSortKey;
  onChange: (v: WatchlistSortKey) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as WatchlistSortKey)}
        className="cursor-pointer appearance-none rounded-md border border-white/10 bg-surface-elevated/60 py-1.5 pl-3 pr-8 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {(Object.keys(SORT_LABELS) as WatchlistSortKey[]).map((k) => (
          <option key={k} value={k}>
            {SORT_LABELS[k]}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-white/10 bg-surface-elevated/60 p-0.5">
      <button
        type="button"
        aria-label="Grid view"
        onClick={() => onChange('grid')}
        className={`cursor-pointer rounded p-1.5 ${
          value === 'grid' ? 'bg-primary text-white' : 'text-neutral-400 hover:text-neutral-200'
        }`}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="List view"
        onClick={() => onChange('list')}
        className={`cursor-pointer rounded p-1.5 ${
          value === 'list' ? 'bg-primary text-white' : 'text-neutral-400 hover:text-neutral-200'
        }`}
      >
        <ListIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function WatchlistGrid({ items }: { items: WatchlistItem[] }) {
  const remove = useRemoveFromWatchlist();
  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-5">
      {items.map((it) => (
        <WatchlistGridCard
          key={`${it.mediaType}-${it.mediaId}`}
          item={it}
          onRemove={() => remove.mutate({ mediaId: it.mediaId, mediaType: it.mediaType })}
        />
      ))}
    </div>
  );
}

function WatchlistGridCard({ item, onRemove }: { item: WatchlistItem; onRemove: () => void }) {
  const route = mediaTypeToRoute(item.mediaType);
  const rating = item.voteAverage > 0 ? item.voteAverage.toFixed(1) : null;
  return (
    <div className="group relative">
      <Link to={`/title/${route}/${item.mediaId}`} className="flex flex-col gap-2">
        <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-elevated ring-1 ring-border-subtle">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt={item.title}
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
              No image
            </div>
          )}
          {rating && (
            <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-accent-light backdrop-blur">
              <Star className="h-3 w-3 fill-accent text-accent" />
              {rating}
            </div>
          )}
        </div>
        <div>
          <div className="line-clamp-1 text-sm font-medium text-neutral-100">{item.title}</div>
          <div className="text-xs text-neutral-500">{item.releaseYear || ''}</div>
        </div>
      </Link>
      <button
        type="button"
        aria-label="Remove from watchlist"
        onClick={(e) => {
          e.preventDefault();
          onRemove();
        }}
        className="absolute left-2 top-2 hidden cursor-pointer rounded-full bg-black/70 p-1.5 text-white transition hover:bg-red-900/80 group-hover:block"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function WatchlistList({ items }: { items: WatchlistItem[] }) {
  const remove = useRemoveFromWatchlist();
  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const route = mediaTypeToRoute(it.mediaType);
        const rating = it.voteAverage > 0 ? it.voteAverage.toFixed(1) : null;
        return (
          <li
            key={`${it.mediaType}-${it.mediaId}`}
            className="flex gap-4 rounded-xl border border-border-subtle/60 bg-surface-elevated/40 p-3 transition hover:bg-surface-elevated/70"
          >
            <Link
              to={`/title/${route}/${it.mediaId}`}
              className="block h-24 w-40 shrink-0 overflow-hidden rounded-lg bg-black/40"
            >
              {it.backdropUrl ? (
                <img src={it.backdropUrl} alt={it.title} className="h-full w-full object-cover" />
              ) : it.posterUrl ? (
                <img src={it.posterUrl} alt={it.title} className="h-full w-full object-cover" />
              ) : null}
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                to={`/title/${route}/${it.mediaId}`}
                className="block text-sm font-semibold text-neutral-100 hover:text-accent-light"
              >
                {it.title}
                {it.releaseYear ? <span className="text-neutral-500"> · {it.releaseYear}</span> : null}
              </Link>
              {it.genres.length > 0 && (
                <div className="mt-0.5 text-xs text-neutral-500">{it.genres.slice(0, 4).join(' · ')}</div>
              )}
              {it.overview && (
                <p className="mt-1 line-clamp-2 text-xs text-neutral-400">{it.overview}</p>
              )}
            </div>
            <div className="flex flex-col items-end justify-between gap-2">
              {rating && (
                <div className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-xs font-semibold text-accent-light">
                  <Star className="h-3 w-3 fill-accent text-accent" />
                  {rating}
                </div>
              )}
              <button
                type="button"
                onClick={() => remove.mutate({ mediaId: it.mediaId, mediaType: it.mediaType })}
                className="cursor-pointer rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-neutral-200 transition hover:bg-red-900/30 hover:text-red-200"
              >
                Remove
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const sub =
    filter === 'all'
      ? 'Your watchlist is empty — browse movies and series to add them.'
      : `No ${filter === 'movie' ? 'movies' : 'series'} in your watchlist yet.`;
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-subtle/60 bg-surface-elevated/30 px-6 py-16 text-center">
      <Bookmark className="h-10 w-10 text-neutral-600" />
      <p className="text-sm text-neutral-400">{sub}</p>
      <Link
        to="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90"
      >
        Browse
      </Link>
    </div>
  );
}

