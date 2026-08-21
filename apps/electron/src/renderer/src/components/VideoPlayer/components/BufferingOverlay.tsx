import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, X } from 'lucide-react';
import { useTorrentStats } from '../../../lib/torrent';
import { fmtDuration, fmtEta, fmtSpeed } from '../utils/format';

export function BufferingOverlay({
  percent,
  title,
  subtitle,
  quality,
  sourceLabel,
  posterUrl,
  stats,
  onBack,
}: {
  percent: number;
  title: string;
  subtitle?: string;
  quality?: string;
  sourceLabel?: string;
  posterUrl?: string;
  stats: ReturnType<typeof useTorrentStats>;
  onBack: () => void;
}) {
  const numPeers = stats?.numPeers ?? 0;
  const downloadSpeedBps = stats?.downloadSpeedBps ?? 0;
  const durationSec = stats?.durationSeconds ?? 0;

  // ponytail: surface a "still trying" hint if buffering drags on, so a dead
  // torrent doesn't leave the user staring at a silent spinner.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 25_000);
    return () => clearTimeout(t);
  }, []);

  // ponytail: ETA from observed buffer velocity since first non-zero sample.
  // Linear projection — good enough for a transient UI hint. Swap for a
  // smoothed estimate if it visibly jitters.
  const anchorRef = useRef<{ t: number; pct: number } | null>(null);
  const [etaSec, setEtaSec] = useState<number | null>(null);
  useEffect(() => {
    if (percent <= 0 || percent >= 100) return;
    if (!anchorRef.current) {
      anchorRef.current = { t: Date.now(), pct: percent };
      return;
    }
    const { t, pct } = anchorRef.current;
    const elapsed = (Date.now() - t) / 1000;
    const gained = percent - pct;
    if (gained > 0 && elapsed > 1) {
      setEtaSec(Math.max(0, Math.round(((100 - percent) * elapsed) / gained)));
    }
  }, [percent]);

  const meta = [
    subtitle,
    durationSec > 0 ? fmtDuration(durationSec) : null,
    quality,
    sourceLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  const R = 42;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = C * (1 - clamped / 100);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-black">
      {posterUrl && (
        <div
          aria-hidden
          className="absolute inset-0 scale-110 opacity-25 blur-3xl"
          style={{
            backgroundImage: `url(${posterUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-5 px-6 text-center">
        {posterUrl && (
          <img
            src={posterUrl}
            alt=""
            className="aspect-[3/4] w-30 rounded-lg object-cover shadow-2xl ring-1 ring-white/10"
          />
        )}

        <div className="space-y-1">
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          {meta && <p className="text-sm text-neutral-400">{meta}</p>}
        </div>

        {/* <div className="relative h-24 w-24">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="4"
            />
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              className="stroke-accent transition-[stroke-dashoffset] duration-500"
              strokeWidth="4"
              strokeDasharray={C}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums text-white">
            {clamped}%
          </div>
        </div> */}

        <div className="space-y-1 mt-10 animate-pulse">
          <p className="text-sm font-medium text-neutral-200">Buffering stream…</p>
          <p className="text-xs text-neutral-400">
            {numPeers > 0
              ? `Fetching pieces from ${numPeers} peer${numPeers === 1 ? '' : 's'}`
              : 'Connecting to peers…'}
          </p>
        </div>

        {slow && downloadSpeedBps <= 0 && (
          <p className="max-w-xs text-xs text-amber-400/90">
            Taking longer than usual — this source may have too few seeders. You
            can keep waiting or go back and try another stream.
          </p>
        )}

        {/* <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${clamped}%` }}
          />
        </div> */}

        <div className="grid w-full grid-cols-3 gap-4 mt-10">
          <BufStat
            icon={<ArrowDown className="h-3.5 w-3.5 text-accent" />}
            value={fmtSpeed(downloadSpeedBps)}
            valueClassName="text-accent"
            label="Download"
          />
          <BufStat value={numPeers > 0 ? String(numPeers) : '—'} label="Active Peers" />
          <BufStat
            value={etaSec !== null ? `~${fmtEta(etaSec)}` : '—'}
            label="Est. wait"
          />
        </div>

        <button
          type="button"
          onClick={onBack}
          className="mt-20 flex cursor-pointer items-center gap-1.5 text-sm text-neutral-400 transition hover:text-white"
        >
          <X className="h-4 w-4" />
          Cancel and go back
        </button>
      </div>
    </div>
  );
}

function BufStat({
  icon,
  value,
  valueClassName,
  label,
}: {
  icon?: ReactNode;
  value: string;
  valueClassName?: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={`flex items-center gap-1 text-sm font-semibold tabular-nums ${
          valueClassName ?? 'text-neutral-100'
        }`}
      >
        {icon}
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  );
}
