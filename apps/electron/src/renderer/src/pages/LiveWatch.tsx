import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Hls from 'hls.js';
import { backendUrl } from '../lib/client';

export interface LiveState {
  title: string;
  index: number;
  streams: { name: string; title: string; playUrl: string }[];
}

// Live HLS player. Deliberately separate from VideoPlayer, which is built
// around torrents (peers, seeking into undownloaded ranges, resume progress).
export function LiveWatch() {
  const state = useLocation().state as LiveState | null;
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(state?.index ?? 0);
  const [error, setError] = useState<string | null>(null);
  const streams = state?.streams ?? [];
  const stream = streams[index];

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    setError(null);
    // Worker off: it loads from a blob: URL that the CSP's worker-src doesn't allow.
    const hls = new Hls({ enableWorker: false });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      // Restreams die often: fail over to the next source.
      if (index + 1 < streams.length) setIndex(index + 1);
      else
        setError('All streams failed. Go back and retry — new streams often appear near kickoff.');
    });
    hls.loadSource(backendUrl() + stream.playUrl);
    hls.attachMedia(video);
    void video.play().catch(() => {});
    return () => hls.destroy();
  }, [stream, index, streams.length]);

  if (!state || !stream) return <Navigate to="/sports" replace />;

  return (
    <div className="relative h-screen w-screen bg-black">
      <video ref={videoRef} className="h-full w-full object-contain" controls autoPlay />

      <div className="absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="rounded-md p-2 text-neutral-200 transition hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="flex-1 truncate text-sm font-medium text-neutral-100">{state.title}</span>
        <select
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label="Stream"
          className="max-w-64 rounded-md bg-white/10 px-2 py-1 text-sm text-neutral-100"
        >
          {streams.map((s, i) => (
            <option key={s.playUrl} value={i} className="bg-neutral-900">
              {s.name || `Stream ${i + 1}`}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="absolute inset-x-0 bottom-20 mx-auto w-fit rounded-lg bg-black/80 px-4 py-2 text-sm text-neutral-200">
          {error}
        </p>
      )}
    </div>
  );
}
