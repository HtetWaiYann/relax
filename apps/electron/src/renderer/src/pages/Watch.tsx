import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { MediaType } from '@relax/types';
import { VideoPlayer } from '../components/VideoPlayer';
import { startStream, stopStream, type StartStreamResult } from '../lib/torrent';

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
}

export function Watch() {
  const params = useParams<{ infoHash: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as WatchState | null;
  const [stream, setStream] = useState<StartStreamResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state || state.infoHash !== params.infoHash) return;
    let cancelled = false;
    void startStream({
      infoHash: state.infoHash,
      fileIdx: state.fileIdx,
      magnetUri: state.magnetUri,
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
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
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
      onBack={() => navigate(-1)}
    />
  );
}
