import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, Trash2, FolderOpen } from 'lucide-react';
import {
  clearCache,
  getAppPaths,
  getCacheStats,
  getCacheTtlDays,
  setCacheTtlDays,
  type AppPaths,
  type CacheStats,
} from '../lib/torrent';
import { useClearWatchHistory, useClearWatchlist } from '../lib/queries';

type ModalKind = 'none' | 'clear-cache' | 'clear-history' | 'clear-watchlist';

export function Settings() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [ttlDays, setTtlDays] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalKind>('none');
  const [clearing, setClearing] = useState(false);
  const clearHistory = useClearWatchHistory();
  const clearWatchlist = useClearWatchlist();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, t] = await Promise.all([getCacheStats(), getAppPaths(), getCacheTtlDays()]);
      setStats(s);
      setPaths(p);
      setTtlDays(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const clearOne = async (infoHash: string) => {
    await clearCache(infoHash);
    await refresh();
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await clearCache();
      await refresh();
    } finally {
      setClearing(false);
      setModal('none');
    }
  };

  const clearAllHistory = async () => {
    await clearHistory.mutateAsync();
    setModal('none');
  };

  const clearAllWatchlist = async () => {
    await clearWatchlist.mutateAsync();
    setModal('none');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Settings</h1>
          <p className="mt-1 text-sm text-neutral-400">Local storage, cache, and watch history.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-neutral-200 transition hover:bg-white/10"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-neutral-100">Storage & cache</h2>

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="App size" value={stats ? fmtBytes(stats.totalAppBytes) : '—'} />
          <StatCard label="Cache" value={stats ? fmtBytes(stats.cacheBytes) : '—'} />
          <StatCard label="Database" value={stats ? fmtBytes(stats.dbBytes) : '—'} />
        </div>

        <div className="rounded-xl border border-white/10 bg-surface-elevated">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <span className="text-sm font-medium text-neutral-200">Cached titles</span>
            <span className="text-xs text-neutral-500">{stats?.entries.length ?? 0} on disk</span>
          </div>
          {stats && stats.entries.length > 0 ? (
            <ul className="max-h-96 divide-y divide-white/5 overflow-y-auto">
              {stats.entries.map((e) => (
                <li key={e.infoHash || e.torrentName} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-black/40">
                    {e.posterUrl && <img src={e.posterUrl} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-neutral-100" title={e.title}>{e.title}</div>
                    <div className="truncate text-xs text-neutral-500">
                      {fmtBytes(e.cachedBytes)} · {fmtRelative(e.lastAccessedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void clearOne(e.infoHash || '')}
                    disabled={!e.infoHash}
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    title={e.infoHash ? 'Clear this title' : 'No info hash — clear manually'}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Clear
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-xs text-neutral-500">
              No cached torrents.
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setModal('clear-cache')}
            className="cursor-pointer rounded-md border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-sm text-red-200 transition hover:bg-red-900/30"
          >
            Clear all cache
          </button>
          <button
            type="button"
            onClick={() => setModal('clear-history')}
            className="cursor-pointer rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-neutral-200 transition hover:bg-white/10"
          >
            Clear watch history
          </button>
          <button
            type="button"
            onClick={() => setModal('clear-watchlist')}
            className="cursor-pointer rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-neutral-200 transition hover:bg-white/10"
          >
            Clear watchlist
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-neutral-100">Other</h2>
        <StubRow
          icon={<FolderOpen className="h-4 w-4" />}
          label="Downloads folder"
          value={paths?.torrents ?? '—'}
        />
        <StubRow label="Cache window" value={paths ? `${paths.cacheWindowMb} MB around playback` : '—'} />
        <StubRow label="Keep downloads on disk" value={paths ? (paths.keepDownloads ? 'On' : 'Off') : '—'} />
        <div className="flex items-center justify-between rounded-lg border border-white/5 bg-surface-elevated/60 px-4 py-3">
          <div className="text-sm text-neutral-200">Auto-clear cache</div>
          <select
            value={ttlDays}
            onChange={async (e) => {
              const v = Number(e.target.value);
              setTtlDays(v);
              await setCacheTtlDays(v);
              await refresh();
            }}
            className="cursor-pointer rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value={0}>Off</option>
            <option value={1}>After 1 day</option>
            <option value={3}>After 3 days</option>
            <option value={5}>After 5 days</option>
            <option value={7}>After 7 days</option>
            <option value={14}>After 14 days</option>
            <option value={30}>After 30 days</option>
          </select>
        </div>
      </section>

      {modal === 'clear-cache' && (
        <Modal
          title="Clear all cache?"
          body="This will delete all downloaded torrent data. Your watch history and progress will be kept. This cannot be undone."
          confirmLabel={clearing ? 'Clearing…' : 'Clear cache'}
          danger
          confirmDisabled={clearing}
          onCancel={() => setModal('none')}
          onConfirm={() => void clearAll()}
        />
      )}
      {modal === 'clear-history' && (
        <Modal
          title="Clear watch history?"
          body="This will remove all Continue Watching entries and watch progress. Downloaded cache is not affected."
          confirmLabel="Clear history"
          danger
          onCancel={() => setModal('none')}
          onConfirm={() => void clearAllHistory()}
        />
      )}
      {modal === 'clear-watchlist' && (
        <Modal
          title="Clear watchlist?"
          body="This will remove all titles from your watchlist. This cannot be undone."
          confirmLabel={clearWatchlist.isPending ? 'Clearing…' : 'Clear watchlist'}
          danger
          confirmDisabled={clearWatchlist.isPending}
          onCancel={() => setModal('none')}
          onConfirm={() => void clearAllWatchlist()}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-surface-elevated p-4">
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-neutral-100">{value}</div>
    </div>
  );
}

function StubRow({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-surface-elevated/60 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-neutral-200">
        {icon}
        <span>{label}</span>
      </div>
      <span className="max-w-[60%] truncate text-xs text-neutral-400" title={value}>{value}</span>
    </div>
  );
}

function Modal({
  title, body, confirmLabel, danger, confirmDisabled, onCancel, onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-white/10 bg-surface-elevated p-5">
        <h3 className="text-base font-semibold text-neutral-100">{title}</h3>
        <p className="text-sm text-neutral-300">{body}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-neutral-200 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
              danger
                ? 'border border-red-900/50 bg-red-900/30 text-red-100 hover:bg-red-900/50'
                : 'border border-white/10 bg-primary text-white hover:bg-primary/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtRelative(ms: number): string {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}m ago`;
  if (diff < day) return `${Math.round(diff / hour)}h ago`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString();
}
