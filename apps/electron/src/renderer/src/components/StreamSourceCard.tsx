import { Play, ArrowUp, AlertCircle } from 'lucide-react';
import type { StreamSource } from '@relax/types';

const LOW_SEEDER_THRESHOLD = 5;

interface StreamSourceCardProps {
  stream: StreamSource;
  onSelect: (stream: StreamSource) => void;
}

export function StreamSourceCard({ stream, onSelect }: StreamSourceCardProps) {
  const quality = stream.quality || '—';
  const sizeLabel = stream.sizeBytes > 0 ? formatBytes(Number(stream.sizeBytes)) : '';
  const seeders = stream.seeders > 0 ? stream.seeders : null;
  const sourceParts = (stream.sourceName || '').split(' - ');
  const codec = pickCodec(stream.title);
  const tracker = sourceParts.length > 1 ? sourceParts[sourceParts.length - 1] : '';

  return (
    <article className="space-y-2 rounded-xl bg-surface-elevated/70 px-4 py-3 ring-1 ring-border-subtle/60 transition hover:bg-surface-elevated">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-md bg-accent px-2 py-0.5 font-semibold text-surface">
            {quality}
          </span>
          {/* {codec && <span className="font-medium text-neutral-300">{codec}</span>}
          {tracker && <span className="text-neutral-400">{tracker}</span>} */}
        </div>
        {sizeLabel && (
          <span className="text-xs font-medium text-neutral-300">{sizeLabel}</span>
        )}
      </header>

      <p className="line-clamp-3 text-xs break-all text-neutral-500" title={stream.title}>
        {stream.title}
      </p>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-3 text-xs text-neutral-400">
          {seeders !== null && (
            <span className="flex items-center gap-1">
              <ArrowUp className="h-3.5 w-3.5 text-accent" />
              <span className="font-medium text-neutral-200">{seeders}</span>
            </span>
          )}
          <SeedBar seeders={seeders ?? 0} />
          {seeders !== null && seeders < LOW_SEEDER_THRESHOLD && (
            <span
              title="Low seeders — may be slow"
              className="flex items-center gap-1 text-amber-400/90"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              <span>slow</span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onSelect(stream)}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-accent/50"
          title={stream.title}
        >
          <Play className="h-3.5 w-3.5 fill-white" />
          Stream
        </button>
      </div>
    </article>
  );
}

function SeedBar({ seeders }: { seeders: number }) {
  // ponytail: log scale, capped — good enough until we have real health data.
  const pct = seeders <= 0 ? 5 : Math.min(100, Math.round((Math.log10(seeders + 1) / 4) * 100));
  return (
    <div className="h-1 w-20 overflow-hidden rounded-full bg-surface-muted">
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

function pickCodec(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('x265') || lower.includes('hevc')) return 'x265';
  if (lower.includes('x264') || lower.includes('h264')) return 'x264';
  if (lower.includes('av1')) return 'AV1';
  return '';
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
