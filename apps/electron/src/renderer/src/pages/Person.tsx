import { Link, useParams } from 'react-router-dom';
import { Calendar, MapPin, Star } from 'lucide-react';
import { usePersonDetail, mediaTypeToRoute } from '../lib/queries';
import { Skeleton } from '../components/Skeleton';

export function Person() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data, isLoading, error } = usePersonDetail(Number.isFinite(id) ? id : 0);

  if (isLoading || !data) {
    return <PersonSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-6 text-red-200">
        <h2 className="text-lg font-semibold">Couldn't load person</h2>
        <p className="mt-2 text-sm">{error.message}</p>
      </div>
    );
  }

  const p = data.detail;
  if (!p) return null;

  return (
    <div className="space-y-12">
      <section className="flex flex-col gap-8 md:flex-row md:items-start">
        <div className="h-72 w-48 shrink-0 overflow-hidden rounded-xl bg-surface-elevated ring-1 ring-border-subtle">
          {p.profileUrl ? (
            <img src={p.profileUrl} alt={p.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl text-neutral-600">
              {p.name.slice(0, 1)}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white">{p.name}</h1>
            {p.knownForDepartment && (
              <p className="mt-1 text-sm uppercase tracking-wide text-accent-light">
                {p.knownForDepartment}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-neutral-300">
            {p.birthday && (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-neutral-400" />
                {p.birthday}
                {p.deathday && ` – ${p.deathday}`}
              </span>
            )}
            {p.placeOfBirth && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-neutral-400" />
                {p.placeOfBirth}
              </span>
            )}
          </div>

          {p.biography && (
            <div className="max-w-3xl space-y-2">
              <h2 className="text-lg font-semibold text-neutral-100">Biography</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-300">
                {p.biography}
              </p>
            </div>
          )}
        </div>
      </section>

      {p.credits.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-neutral-100">
            Filmography <span className="text-neutral-500">({p.credits.length})</span>
          </h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {p.credits.map((c, i) => {
              const route = mediaTypeToRoute(c.mediaType);
              const year = c.releaseDate ? c.releaseDate.slice(0, 4) : '';
              const rating = c.voteAverage > 0 ? c.voteAverage.toFixed(1) : null;
              return (
                <Link
                  key={`${route}-${c.tmdbId}-${i}`}
                  to={`/title/${route}/${c.tmdbId}`}
                  className="group flex flex-col gap-2"
                >
                  <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-elevated ring-1 ring-border-subtle">
                    {c.posterUrl ? (
                      <img
                        src={c.posterUrl}
                        alt={c.title}
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
                    <div className="line-clamp-1 text-sm font-medium text-neutral-100">
                      {c.title}
                    </div>
                    {c.character && (
                      <div className="line-clamp-1 text-xs text-neutral-500">as {c.character}</div>
                    )}
                    <div className="text-xs text-neutral-500">{year}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function PersonSkeleton() {
  return (
    <div className="space-y-12">
      <div className="flex flex-col gap-8 md:flex-row">
        <Skeleton className="h-72 w-48 rounded-xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
