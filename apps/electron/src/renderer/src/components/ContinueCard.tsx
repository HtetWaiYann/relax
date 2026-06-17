import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { MediaType, type WatchProgress } from '@relax/types';
import { mediaTypeToRoute, useDeleteWatchProgress } from '../lib/queries';
import type { WatchState } from '../pages/Watch';

export function ContinueCard({ item }: { item: WatchProgress }) {
  const navigate = useNavigate();
  const del = useDeleteWatchProgress();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const pct = item.durationSeconds > 0
    ? Math.min(100, Math.max(0, (item.positionSeconds / item.durationSeconds) * 100))
    : 0;
  const isTV = item.mediaType === MediaType.TV;

  const playStream = () => {
    const state: WatchState = {
      infoHash: item.infoHash,
      fileIdx: item.fileIdx,
      magnetUri: item.magnetUri,
      title: item.title,
      subtitle: isTV ? `S${item.season} · E${item.episode}` : undefined,
      tmdbId: Number(item.mediaId) || 0,
      mediaType: item.mediaType,
      season: item.season,
      episode: item.episode,
      resumeSeconds: item.positionSeconds,
      posterUrl: item.posterUrl,
    };
    navigate(`/watch/${item.infoHash}`, { state });
  };

  const openDetail = () => {
    const tmdbId = Number(item.mediaId);
    if (!tmdbId) return;
    navigate(`/title/${mediaTypeToRoute(item.mediaType)}/${tmdbId}`);
  };

  return (
    <div
      className="group flex w-[170px] shrink-0 cursor-zoom-in flex-col gap-2 sm:w-[180px]"
      onClick={openDetail}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-elevated ring-1 ring-border-subtle transition">
        {item.posterUrl ? (
          <img src={item.posterUrl} alt={item.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">No poster</div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
        <button
          type="button"
          aria-label="Resume playback"
          onClick={(e) => { e.stopPropagation(); playStream(); }}
          className="absolute inset-0 flex cursor-pointer items-center justify-center opacity-0 transition group-hover:opacity-100"
        >
          <span className="rounded-full bg-primary p-3 shadow-lg ring-2 ring-accent-light/50">
            <Play className="h-5 w-5 fill-white text-white" />
          </span>
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/60">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div>
        <div className="line-clamp-1 text-sm font-medium text-neutral-100" title={item.title}>{item.title}</div>
        <div className="text-xs text-neutral-500">
          {isTV ? `S${item.season} · E${item.episode} · ` : ''}{fmtRelative(item.lastWatchedAt)}
        </div>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setMenu(null); }} />
          <div
            className="fixed z-50 min-w-[200px] rounded-md border border-white/10 bg-surface-elevated p-1 text-sm shadow-2xl"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                del.mutate({
                  mediaId: item.mediaId,
                  mediaType: item.mediaType,
                  season: item.season,
                  episode: item.episode,
                });
                setMenu(null);
              }}
              className="w-full cursor-pointer rounded px-3 py-1.5 text-left text-neutral-200 hover:bg-white/10"
            >
              Remove from Continue Watching
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function fmtRelative(ts: { seconds: bigint } | undefined): string {
  if (!ts) return '';
  const ms = Number(ts.seconds) * 1000;
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
