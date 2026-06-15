import { Link, useParams } from 'react-router-dom';
import { Star, Calendar, Clock, Globe2 } from 'lucide-react';
import { mediaTypeFromRoute, useMediaDetail } from '../lib/queries';
import { GenrePill } from '../components/GenrePill';
import { HorizontalRow } from '../components/HorizontalRow';
import { PosterCard } from '../components/PosterCard';
import { DetailHeroSkeleton, HorizontalRowSkeleton } from '../components/Skeleton';

export function Detail() {
  const params = useParams<{ mediaType: string; id: string }>();
  const mediaType = mediaTypeFromRoute(params.mediaType);
  const id = Number(params.id);
  const { data, isLoading, error } = useMediaDetail(mediaType, Number.isFinite(id) ? id : 0);

  if (isLoading || !data) {
    return (
      <div className="space-y-10">
        <DetailHeroSkeleton />
        <HorizontalRowSkeleton label="Cast" />
        <HorizontalRowSkeleton label="Similar titles" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-6 text-red-200">
        <h2 className="text-lg font-semibold">Couldn't load title</h2>
        <p className="mt-2 text-sm">{error.message}</p>
      </div>
    );
  }

  const detail = data.detail;
  if (!detail || !detail.summary) {
    return null;
  }
  const summary = detail.summary;
  const year = summary.releaseDate ? summary.releaseDate.slice(0, 4) : '';
  const runtime = detail.runtimeMinutes > 0 ? formatRuntime(detail.runtimeMinutes) : '';
  const rating = summary.voteAverage > 0 ? summary.voteAverage.toFixed(1) : null;

  return (
    <div className="-mx-6 -mt-8 space-y-12">
      <section className="relative h-[480px] overflow-hidden">
        {summary.backdropUrl && (
          <img
            src={summary.backdropUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/85 to-surface/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-surface/95 via-surface/40 to-primary/20" />

        <div className="relative z-10 mx-auto flex h-full max-w-7xl items-end gap-8 px-6 pb-10">
          {summary.posterUrl && (
            <img
              src={summary.posterUrl}
              alt={summary.title}
              className="hidden h-64 w-44 rounded-xl object-cover shadow-2xl ring-1 ring-border-subtle md:block"
            />
          )}

          <div className="max-w-2xl space-y-3">
            <h1 className="text-4xl font-bold tracking-tight text-white">{summary.title}</h1>

            {detail.tagline && (
              <p className="text-base italic text-accent-light">{detail.tagline}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-neutral-300">
              {rating && (
                <span className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-accent text-accent" />
                  {rating}
                </span>
              )}
              {year && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-neutral-400" />
                  {year}
                </span>
              )}
              {runtime && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-neutral-400" />
                  {runtime}
                </span>
              )}
              {detail.originalLanguage && (
                <span className="flex items-center gap-1.5 uppercase">
                  <Globe2 className="h-4 w-4 text-neutral-400" />
                  {detail.originalLanguage}
                </span>
              )}
              {detail.status && (
                <span className="rounded-md bg-surface-elevated/80 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-300">
                  {detail.status}
                </span>
              )}
            </div>

            {detail.genres.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {detail.genres.map((g) => (
                  <GenrePill key={g.id} name={g.name} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-12 px-6">
        {detail.overview && (
          <section className="max-w-3xl space-y-2">
            <h2 className="text-lg font-semibold text-neutral-100">Overview</h2>
            <p className="text-sm leading-relaxed text-neutral-300">{detail.overview}</p>
          </section>
        )}

        {detail.cast.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-neutral-100">Cast</h2>
            <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
              {detail.cast.map((c) => (
                <Link
                  key={c.id}
                  to={`/person/${c.id}`}
                  className="group flex w-[120px] shrink-0 flex-col items-center gap-2 text-center"
                >
                  <div className="h-24 w-24 overflow-hidden rounded-full bg-surface-elevated ring-1 ring-border-subtle transition">
                    {c.profileUrl ? (
                      <img
                        src={c.profileUrl}
                        alt={c.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.05]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
                        {c.name.slice(0, 1)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="line-clamp-1 text-sm font-medium text-neutral-100 group-hover:text-accent-light">
                      {c.name}
                    </div>
                    <div className="line-clamp-1 text-xs text-neutral-500">{c.character}</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {detail.similar.length > 0 && (
          <HorizontalRow label="Similar titles">
            {detail.similar.map((item) => (
              <PosterCard key={`${item.mediaType}-${item.tmdbId}`} item={item} />
            ))}
          </HorizontalRow>
        )}
      </div>
    </div>
  );
}

function formatRuntime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
