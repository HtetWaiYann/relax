import { useHomeSections, useWatchHistory } from '../lib/queries';
import { FeaturedHero } from '../components/FeaturedHero';
import { HorizontalRow } from '../components/HorizontalRow';
import { PosterCard } from '../components/PosterCard';
import { ContinueCard } from '../components/ContinueCard';
import {
  FeaturedHeroSkeleton,
  HorizontalRowSkeleton,
} from '../components/Skeleton';

const SECTION_LABELS = [
  'Popular Movies',
  'Top Rated Movies',
  'Trending This Week',
  'Popular Series',
  'Top Rated Series',
];

export function Home() {
  const { data, isLoading, error, refetch } = useHomeSections();
  const history = useWatchHistory(20);
  const historyItems = history.data?.items ?? [];

  if (error) {
    return <ErrorBlock onRefresh={() => refetch()} />;
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-10">
        <FeaturedHeroSkeleton />
        {SECTION_LABELS.map((label) => (
          <HorizontalRowSkeleton key={label} label={label} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {data.featured && <FeaturedHero detail={data.featured} />}

      {historyItems.length > 0 && (
        <HorizontalRow label="Continue Watching">
          {historyItems.map((it) => (
            <ContinueCard key={`${it.mediaId}-${it.mediaType}-${it.season}-${it.episode}`} item={it} />
          ))}
        </HorizontalRow>
      )}

      {data.sections.map((section) => (
        <HorizontalRow key={section.category} label={section.label}>
          {section.items.map((item) => (
            <PosterCard key={`${item.mediaType}-${item.tmdbId}`} item={item} />
          ))}
        </HorizontalRow>
      ))}
    </div>
  );
}

function ErrorBlock({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="p-6 text-red-200 mx-auto flex items-center flex-col space-y-4">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-red-300/80">
        We couldn't load your movies and shows. Please try again.
      </p>
      <div className="mt-4 flex gap-3">
        <button
          onClick={onRefresh}
          className="cursor-pointer rounded-lg bg-red-200 px-4 py-2 text-sm font-medium text-red-950 hover:bg-red-100"
        >
          Refresh
        </button>
        {/* <button
          onClick={() => window.relax?.restartApp()}
          className="cursor-pointer rounded-lg border border-red-800 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900/40"
        >
          Restart app
        </button> */}
      </div>
    </div>
  );
}
