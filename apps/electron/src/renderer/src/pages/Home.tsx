import { useHomeSections } from '../lib/queries';
import { FeaturedHero } from '../components/FeaturedHero';
import { HorizontalRow } from '../components/HorizontalRow';
import { PosterCard } from '../components/PosterCard';
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
  const { data, isLoading, error } = useHomeSections();

  if (error) {
    return <ErrorBlock message={error.message} />;
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

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-6 text-red-200">
      <h2 className="text-lg font-semibold">Couldn't load metadata</h2>
      <p className="mt-2 text-sm">{message}</p>
      <p className="mt-3 text-xs text-red-300/70">
        Make sure <code className="rounded bg-black/30 px-1">TMDB_API_KEY</code> is set in{' '}
        <code className="rounded bg-black/30 px-1">apps/backend/.env</code> and the backend is running.
      </p>
    </div>
  );
}
