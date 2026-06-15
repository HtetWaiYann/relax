import { useEffect } from 'react';
import { PosterCard } from '../components/PosterCard';
import { PosterCardSkeleton } from '../components/Skeleton';
import { LoadMore } from '../components/LoadMore';
import { useInfiniteBrowseMedia, type BrowseKind } from '../lib/queries';

interface BrowseProps {
  kind: BrowseKind;
  title: string;
  subtitle: string;
}

export function Browse({ kind, title, subtitle }: BrowseProps) {
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteBrowseMedia(kind);

  // Reset to top when switching kinds.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [kind]);

  const items = data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-100">{title}</h1>
        <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-red-200">
          {error.message}
        </div>
      )}

      {isLoading && <GridSkeleton count={18} />}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item, i) => (
            <PosterCard key={`${item.mediaType}-${item.tmdbId}-${i}`} item={item} />
          ))}
        </div>
      )}

      {isFetchingNextPage && <GridSkeleton count={6} />}

      <LoadMore
        onIntersect={fetchNextPage}
        enabled={!!hasNextPage && !isFetchingNextPage && !isLoading}
      />

      {!hasNextPage && items.length > 0 && (
        <p className="pt-4 text-center text-sm text-neutral-500">You've reached the end.</p>
      )}

      {data && items.length === 0 && !isLoading && (
        <div className="rounded-xl border border-border-subtle bg-surface-elevated/50 py-20 text-center">
          <p className="text-sm text-neutral-400">Nothing to show.</p>
        </div>
      )}
    </div>
  );
}

function GridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <PosterCardSkeleton key={i} />
      ))}
    </div>
  );
}
