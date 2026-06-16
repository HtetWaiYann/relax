import { Link } from 'react-router-dom';
import { Star, Play } from 'lucide-react';
import type { MediaSummary } from '@relax/types';
import { mediaTypeToRoute } from '../lib/queries';

interface PosterCardProps {
  item: MediaSummary;
  showTypeBadge?: boolean;
}

export function PosterCard({ item, showTypeBadge = false }: PosterCardProps) {
  const route = mediaTypeToRoute(item.mediaType);
  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : '';
  const rating = item.voteAverage > 0 ? item.voteAverage.toFixed(1) : null;

  return (
    <Link
      to={`/title/${route}/${item.tmdbId}`}
      className="group flex w-[170px] shrink-0 flex-col gap-2 sm:w-[180px]"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-elevated ring-1 ring-border-subtle transition">
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

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />

        {rating && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-accent-light backdrop-blur">
            <Star className="h-3 w-3 fill-accent text-accent" />
            {rating}
          </div>
        )}

        {showTypeBadge && (
          <div className="absolute left-2 top-2 rounded-md bg-primary/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
            {route === 'tv' ? 'Series' : 'Movie'}
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <div className="rounded-full bg-primary p-3 shadow-lg ring-2 ring-accent-light/50">
            <Play className="h-5 w-5 fill-white text-white" />
          </div>
        </div>
      </div>

      <div>
        <div className="line-clamp-1 text-sm font-medium text-neutral-100">{item.title}</div>
        <div className="text-xs text-neutral-500">{year}</div>
      </div>
    </Link>
  );
}
