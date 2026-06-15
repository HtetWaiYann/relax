import { Link } from 'react-router-dom';
import { Info, Star } from 'lucide-react';
import type { MediaDetail } from '@relax/types';
import { mediaTypeToRoute } from '../lib/queries';
import { GenrePill } from './GenrePill';

interface FeaturedHeroProps {
  detail: MediaDetail;
}

export function FeaturedHero({ detail }: FeaturedHeroProps) {
  const summary = detail.summary;
  if (!summary) return null;

  const route = mediaTypeToRoute(summary.mediaType);
  const year = summary.releaseDate ? summary.releaseDate.slice(0, 4) : '';
  const runtime = detail.runtimeMinutes > 0 ? formatRuntime(detail.runtimeMinutes) : '';
  const rating = summary.voteAverage > 0 ? summary.voteAverage.toFixed(1) : null;

  return (
    <section className="relative h-[420px] overflow-hidden rounded-2xl ring-1 ring-border-subtle">
      {summary.backdropUrl && (
        <img
          src={summary.backdropUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/80 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-primary/40 via-transparent to-transparent" />

      <div className="relative z-10 flex h-full max-w-2xl flex-col justify-end gap-4 p-8">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
            Featured
          </span>
          {detail.genres.slice(0, 3).map((g) => (
            <GenrePill key={g.id} name={g.name} />
          ))}
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-white">{summary.title}</h1>

        {detail.tagline && (
          <p className="text-sm italic text-accent-light">{detail.tagline}</p>
        )}

        {detail.overview && (
          <p className="line-clamp-3 max-w-xl text-sm text-neutral-200">{detail.overview}</p>
        )}

        <div className="flex items-center gap-4 text-sm text-neutral-300">
          {rating && (
            <span className="flex items-center gap-1">
              <Star className="h-4 w-4 fill-accent text-accent" />
              {rating}
            </span>
          )}
          {year && <span>{year}</span>}
          {runtime && <span>{runtime}</span>}
        </div>

        <div>
          <Link
            to={`/title/${route}/${summary.tmdbId}`}
            className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-2 text-sm font-semibold text-surface transition hover:bg-white"
          >
            <Info className="h-4 w-4" />
            More info
          </Link>
        </div>
      </div>
    </section>
  );
}

function formatRuntime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
