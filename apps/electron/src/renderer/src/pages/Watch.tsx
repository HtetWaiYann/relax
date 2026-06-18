import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { MediaType } from '@relax/types';
import { VideoPlayer } from '../components/VideoPlayer';
import { WatchSidebar } from '../components/WatchSidebar';
import { startStream, stopStream, type StartStreamResult } from '../lib/torrent';
import { useMediaDetail } from '../lib/queries';

export interface WatchState {
  infoHash: string;
  fileIdx: number;
  magnetUri: string;
  title: string;
  subtitle?: string;
  quality?: string;
  sourceLabel?: string;
  tmdbId: number;
  mediaType: MediaType;
  season: number;
  episode: number;
  resumeSeconds?: number;
  posterUrl?: string;
}

export function Watch() {
  const params = useParams<{ infoHash: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as WatchState | null;
  const [stream, setStream] = useState<StartStreamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isTV = state?.mediaType === MediaType.TV;
  const detailQuery = useMediaDetail(
    state?.mediaType ?? MediaType.UNSPECIFIED,
    isTV ? (state?.tmdbId ?? 0) : 0,
  );
  const detail = detailQuery.data?.detail;

  useEffect(() => { setPickerOpen(false); }, [params.infoHash]);

  useEffect(() => {
    if (!state || state.infoHash !== params.infoHash) return;
    let cancelled = false;
    void startStream({
      infoHash: state.infoHash,
      fileIdx: state.fileIdx,
      magnetUri: state.magnetUri,
      positionSeconds: state.resumeSeconds,
      title: state.title,
      posterUrl: state.posterUrl,
    })
      .then((res) => {
        if (!cancelled) setStream(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
      void stopStream(state.infoHash);
    };
  }, [state, params.infoHash]);

  if (!state || !params.infoHash) {
    return <Navigate to="/" replace />;
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-neutral-200">
        <div className="max-w-md space-y-3 rounded-xl border border-red-900/60 bg-red-950/30 p-6 text-sm">
          <h2 className="text-lg font-semibold">Couldn't start stream</h2>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <VideoPlayer
        infoHash={state.infoHash}
        fileIdx={state.fileIdx}
        streamUrl={stream?.streamUrl}
        title={state.title}
        subtitle={state.subtitle}
        quality={state.quality}
        sourceLabel={state.sourceLabel}
        tmdbId={state.tmdbId}
        mediaType={state.mediaType}
        season={state.season}
        episode={state.episode}
        resumeSeconds={state.resumeSeconds}
        magnetUri={state.magnetUri}
        posterUrl={state.posterUrl}
        onBack={() => navigate(-1)}
      />

      {isTV && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="fixed right-4 top-4 z-[60] flex cursor-pointer items-center gap-1.5 rounded-md bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition hover:bg-black/80"
        >
          <Layers className="h-3.5 w-3.5" />
          S{state.season} · E{state.episode}
        </button>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-[70]">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setPickerOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[400px] bg-surface-elevated shadow-2xl">
            {detail ? (
              <WatchSidebar detail={detail} onClose={() => setPickerOpen(false)} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                {detailQuery.isLoading ? 'Loading…' : "Couldn't load details."}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
