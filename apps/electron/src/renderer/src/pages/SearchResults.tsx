import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteSearchMedia } from '../lib/queries';
import { PosterCard } from '../components/PosterCard';
import { PosterCardSkeleton } from '../components/Skeleton';
import { LoadMore } from '../components/LoadMore';

export function SearchResults() {
  const [params] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteSearchMedia(query);

  // Reset scroll when the query changes.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [query]);

  if (!query) {
    return <EmptyState title="Start typing to search" subtitle="Find movies and series by title." />;
  }

  const items = data?.pages.flatMap((p) => p.results) ?? [];
  const totalResults = data?.pages[0]?.totalResults ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-100">
          Results for <span className="text-accent">"{query}"</span>
        </h1>
        {data && (
          <p className="mt-1 text-sm text-neutral-400">
            {totalResults.toLocaleString()} match{totalResults === 1 ? '' : 'es'}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-red-200">
          {error.message}
        </div>
      )}

      {isLoading && <ResultGridSkeleton count={12} />}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item, i) => (
            <PosterCard
              key={`${item.mediaType}-${item.tmdbId}-${i}`}
              item={item}
              showTypeBadge
            />
          ))}
        </div>
      )}

      {isFetchingNextPage && <ResultGridSkeleton count={6} />}

      <LoadMore
        onIntersect={fetchNextPage}
        enabled={!!hasNextPage && !isFetchingNextPage && !isLoading}
      />

      {!hasNextPage && items.length > 0 && (
        <p className="pt-4 text-center text-sm text-neutral-500">End of results.</p>
      )}

      {data && items.length === 0 && !isLoading && (
        <EmptyState
          title={`No results for "${query}"`}
          subtitle="Try a different title or spelling."
        />
      )}
    </div>
  );
}

function ResultGridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <PosterCardSkeleton key={i} />
      ))}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border-subtle bg-surface-elevated/50 py-20 text-center">
      <h2 className="text-lg font-semibold text-neutral-200">{title}</h2>
      <p className="text-sm text-neutral-500">{subtitle}</p>
    </div>
  );
}
