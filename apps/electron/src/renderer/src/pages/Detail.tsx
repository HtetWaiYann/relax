import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Star, Calendar, Clock, Globe2, Play, Plus, Share2 } from 'lucide-react';
import { mediaTypeFromRoute, useMediaDetail } from '../lib/queries';
import { GenrePill } from '../components/GenrePill';
import { HorizontalRow } from '../components/HorizontalRow';
import { PosterCard } from '../components/PosterCard';
import { WatchSidebar } from '../components/WatchSidebar';
import { DetailHeroSkeleton, HorizontalRowSkeleton } from '../components/Skeleton';

export function Detail() {
  const params = useParams<{ mediaType: string; id: string }>();
  const mediaType = mediaTypeFromRoute(params.mediaType);
  const id = Number(params.id);
  const { data, isLoading, error } = useMediaDetail(mediaType, Number.isFinite(id) ? id : 0);
  const [watchOpen, setWatchOpen] = useState(false);

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
    <div className="-mx-6 -mt-8 flex min-h-screen -mb-8">
      <div className="flex-1 space-y-12 overflow-x-hidden">
        <section className="relative h-[420px] overflow-hidden">
          {summary.backdropUrl && (
            <img
              src={summary.backdropUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/70 to-surface/10" />
        </section>

        <div className="-mt-44 px-6 lg:px-10">
          <div className="mx-auto flex max-w-6xl gap-8">
            {summary.posterUrl ? (
              <img
                src={summary.posterUrl}
                alt={summary.title}
                className="z-1 hidden h-64 w-44 shrink-0 rounded-xl object-cover shadow-2xl ring-1 ring-border-subtle md:block"
              />
            ) : (
              <div className="hidden h-64 w-44 shrink-0 rounded-xl bg-surface-muted/40 ring-1 ring-border-subtle md:block" />
            )}

            <div className="flex flex-1 flex-col gap-4 pt-32">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                  <h1 className="text-4xl font-bold tracking-tight text-white">
                    {summary.title}
                  </h1>
                  <MetaRow
                    rating={rating}
                    year={year}
                    runtime={runtime}
                    language={detail.originalLanguage}
                    status={detail.status}
                    genres={detail.genres}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWatchOpen((v) => !v)}
                    className="flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <Play className="h-4 w-4 fill-white" />
                    Watch
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated/60 px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-surface-elevated"
                  >
                    <Plus className="h-4 w-4" />
                    Library
                  </button>
                  <button
                    type="button"
                    aria-label="Share"
                    className="rounded-md border border-border-subtle bg-surface-elevated/60 p-2.5 text-neutral-300 transition hover:bg-surface-elevated"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {detail.overview && (
                <p className="max-w-3xl text-sm leading-relaxed text-neutral-300">
                  {detail.overview}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-6xl space-y-12 px-6 pb-12 lg:px-10">
          {detail.cast.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-neutral-100">Cast</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {detail.cast.slice(0, 8).map((c) => (
                  <Link
                    key={c.id}
                    to={`/person/${c.id}`}
                    className="group flex items-center gap-3 rounded-xl bg-surface-elevated/50 px-3 py-2.5 ring-1 ring-border-subtle/60 transition hover:bg-surface-elevated"
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-surface-muted ring-1 ring-border-subtle">
                      {c.profileUrl ? (
                        <img
                          src={c.profileUrl}
                          alt={c.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
                          {c.name.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
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

      <div
        className={`sticky top-14 h-[calc(100vh-3.5rem)] shrink-0 self-start overflow-hidden transition-[width] duration-300 ease-out ${
          watchOpen ? 'w-[380px]' : 'w-0'
        }`}
      >
        {watchOpen && <WatchSidebar detail={detail} onClose={() => setWatchOpen(false)} />}
      </div>
    </div>
  );
}

function MetaRow({
  rating,
  year,
  runtime,
  language,
  status,
  genres,
}: {
  rating: string | null;
  year: string;
  runtime: string;
  language: string;
  status: string;
  genres: { id: number; name: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-neutral-300">
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
      {language && (
        <span className="flex items-center gap-1.5 uppercase">
          <Globe2 className="h-4 w-4 text-neutral-400" />
          {language}
        </span>
      )}
      {status && (
        <span className="rounded-md bg-surface-elevated/80 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-300">
          {status}
        </span>
      )}
      {genres.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {genres.slice(0, 4).map((g) => (
            <GenrePill key={g.id} name={g.name} />
          ))}
        </span>
      )}
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
