import { useTorrentStats } from '../../../lib/torrent';
import { fmtBytes, fmtSpeed } from '../utils/format';

export function StatsPanel({
  stats,
  onClose,
}: {
  stats: NonNullable<ReturnType<typeof useTorrentStats>>;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-20 w-64 rounded-xl border border-white/10 bg-surface-elevated/95 p-4 text-xs text-neutral-200 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Connection
        </span>
        <button type="button" onClick={onClose} className="cursor-pointer text-neutral-400 hover:text-neutral-100">
          ×
        </button>
      </div>
      <Row label="Download" value={fmtSpeed(stats.downloadSpeedBps)} />
      <Row label="Upload" value={fmtSpeed(stats.uploadSpeedBps)} />
      <Row label="Peers" value={String(stats.numPeers)} />
      <Row label="Seeds" value={String(stats.numSeeds)} />
      <Row label="Progress" value={`${Math.round(stats.progress * 100)}%`} />
      <Row label="Downloaded" value={fmtBytes(stats.downloadedBytes)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-neutral-400">{label}</span>
      <span className="font-medium text-neutral-100">{value}</span>
    </div>
  );
}
