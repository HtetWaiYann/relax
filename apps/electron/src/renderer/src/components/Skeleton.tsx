interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded-md bg-surface-elevated ${className}`} />;
}

export function PosterCardSkeleton() {
  return (
    <div className="flex w-[170px] shrink-0 flex-col gap-2 sm:w-[180px]">
      <Skeleton className="aspect-[2/3] w-full rounded-xl" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}

export function HorizontalRowSkeleton({ label }: { label: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-100">{label}</h2>
      <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <PosterCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

export function FeaturedHeroSkeleton() {
  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-2xl">
      <Skeleton className="h-full w-full rounded-2xl" />
    </div>
  );
}

export function DetailHeroSkeleton() {
  return (
    <div className="relative h-[460px] w-full overflow-hidden">
      <Skeleton className="h-full w-full rounded-none" />
    </div>
  );
}
