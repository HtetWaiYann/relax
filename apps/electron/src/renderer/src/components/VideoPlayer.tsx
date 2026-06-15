import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  ArrowUp,
  Check,
  ChevronLeft,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Settings,
  SkipBack,
  SkipForward,
  Subtitles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ConnectError, Code } from '@connectrpc/connect';
import { type MediaType } from '@relax/types';
import {
  activeCueAt,
  DEFAULT_STYLE,
  loadSubtitleStyle,
  saveSubtitleStyle,
  useParsedVtt,
  type SubtitleStyle,
} from '../lib/subtitle';
import {
  getStreamSubtitles,
  setStreamPosition,
  useTorrentStats,
  type SubtitleTrack,
} from '../lib/torrent';
import { relaxClient } from '../lib/client';

interface VideoPlayerProps {
  infoHash: string;
  fileIdx: number;
  streamUrl: string | undefined;
  title: string;
  subtitle?: string;
  quality?: string;
  sourceLabel?: string;
  tmdbId: number;
  mediaType: MediaType;
  season: number;
  episode: number;
  onBack: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const HIDE_DELAY_MS = 3000;

type TrackLoadState = 'loading' | 'error' | 'quota';

export function VideoPlayer(props: VideoPlayerProps) {
  const {
    infoHash, fileIdx, streamUrl, title, subtitle, quality, sourceLabel,
    tmdbId, mediaType, season, episode, onBack,
  } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionThrottle = useRef<number>(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [rate, setRate] = useState(1);
  const [panel, setPanel] = useState<'none' | 'subs' | 'speed'>('none');
  const [showStats, setShowStats] = useState(false);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<number>(-1);
  const [style, setStyle] = useState<SubtitleStyle>(loadSubtitleStyle);
  const [reBuffering, setReBuffering] = useState(false);
  const [trackState, setTrackState] = useState<Map<number, TrackLoadState>>(new Map());
  const [videoError, setVideoError] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<Array<{id: string; label: string; language: string}>>([]);
  const [selectedAudio, setSelectedAudio] = useState<string>('');
  const [nativeSubTracks, setNativeSubTracks] = useState<Array<{index: number; label: string; language: string}>>([]);
  const [selectedNativeSub, setSelectedNativeSub] = useState<number>(-1);

  const stats = useTorrentStats(infoHash);
  const initialBufferReady = stats?.bufferingComplete ?? false;
  const initialBufferPct = Math.round((stats?.initialBufferProgress ?? 0) * 100);

  // Only use the URL if the track has been resolved (either embedded or downloaded).
  const activeTrackUrl = selectedTrack >= 0 && !trackState.get(selectedTrack)
    ? (tracks[selectedTrack]?.url || null)
    : null;
  const cues = useParsedVtt(activeTrackUrl);
  const activeCue = useMemo(() => activeCueAt(cues, currentTime), [cues, currentTime]);

  // Load embedded subtitles once the buffer is ready, then search OpenSubtitles.
  useEffect(() => {
    if (!initialBufferReady) return;
    void getStreamSubtitles(infoHash, fileIdx).then((embedded) => {
      setTracks(embedded);
      if (tmdbId > 0) {
        void relaxClient
          .searchSubtitles({ tmdbId, mediaType, season, episode })
          .then((res) => {
            const osTracks: SubtitleTrack[] = (res.tracks ?? []).map((t) => ({
              language: t.language,
              label: t.label,
              url: t.url,
              format: t.format,
              sourceName: t.sourceName,
              trackReference: t.trackReference,
            }));
            setTracks((prev) => [...prev, ...osTracks]);
          })
          .catch(() => {
            // Non-critical: leave embedded-only tracks as-is.
          });
      }
    }).catch(() => setTracks([]));
  }, [infoHash, fileIdx, initialBufferReady, tmdbId, mediaType, season, episode]);

  // Persist subtitle style.
  useEffect(() => {
    saveSubtitleStyle(style);
  }, [style]);

  // Auto-hide controls.
  const wake = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false);
    }, HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [wake]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current.requestFullscreen();
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (v.paused) void v.play();
          else v.pause();
          break;
        case 'ArrowRight':
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          v.volume = Math.min(1, v.volume + 0.05);
          setVolume(v.volume);
          break;
        case 'ArrowDown':
          e.preventDefault();
          v.volume = Math.max(0, v.volume - 0.05);
          setVolume(v.volume);
          break;
        case 'm':
          v.muted = !v.muted;
          setMuted(v.muted);
          break;
        case 'f':
          toggleFullscreen();
          break;
      }
      wake();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wake, toggleFullscreen]);

  // Track video element state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const readNativeTracks = () => {
      // Audio tracks — only relevant when > 1 (single-audio files are silent upgrade).
      const ats: Array<{id: string; label: string; language: string}> = [];
      for (let i = 0; i < (v.audioTracks?.length ?? 0); i++) {
        const t = v.audioTracks[i];
        ats.push({ id: t.id || String(i), label: t.label || t.language || `Audio ${i + 1}`, language: t.language });
        if (t.enabled) setSelectedAudio(t.id || String(i));
      }
      if (ats.length > 1) setAudioTracks(ats);

      // Text tracks embedded in the container (MKV subtitle streams, etc).
      const subs: Array<{index: number; label: string; language: string}> = [];
      for (let i = 0; i < v.textTracks.length; i++) {
        const t = v.textTracks[i];
        if (t.kind === 'subtitles' || t.kind === 'captions') {
          t.mode = 'hidden'; // suppress native rendering; we control display
          subs.push({ index: i, label: t.label || t.language || `Sub ${i + 1}`, language: t.language });
        }
      }
      setNativeSubTracks(subs);
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      setShowControls(true);
    };
    const onTime = () => {
      setCurrentTime(v.currentTime);
      const now = performance.now();
      if (now - positionThrottle.current > 1500) {
        positionThrottle.current = now;
        setStreamPosition(infoHash, fileIdx, v.currentTime);
      }
    };
    const onDuration = () => setDuration(v.duration || 0);
    const onProgress = () => {
      if (v.buffered.length > 0) {
        let end = v.buffered.end(v.buffered.length - 1);
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.currentTime >= v.buffered.start(i) && v.currentTime <= v.buffered.end(i)) {
            end = v.buffered.end(i);
            break;
          }
        }
        setBufferedEnd(end);
      }
    };
    const onWait = () => setReBuffering(true);
    const onCanPlay = () => setReBuffering(false);
    const onVolume = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const onRate = () => setRate(v.playbackRate);
    const onMeta = () => { setDuration(v.duration || 0); readNativeTracks(); };
    const onError = () => {
      const code = v.error?.code;
      if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setVideoError('This file format or codec isn\'t supported. Try a different source.');
      } else if (code === MediaError.MEDIA_ERR_NETWORK) {
        setVideoError('Stream connection lost. Check your network and try again.');
      } else if (code) {
        setVideoError(`Playback error (code ${code}). Try a different source.`);
      }
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onDuration);
    v.addEventListener('progress', onProgress);
    v.addEventListener('waiting', onWait);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('playing', onCanPlay);
    v.addEventListener('volumechange', onVolume);
    v.addEventListener('ratechange', onRate);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('error', onError);
    // If metadata is already available (effect re-runs after video renders), read immediately.
    if (v.readyState >= 1) readNativeTracks();
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onDuration);
      v.removeEventListener('progress', onProgress);
      v.removeEventListener('waiting', onWait);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('playing', onCanPlay);
      v.removeEventListener('volumechange', onVolume);
      v.removeEventListener('ratechange', onRate);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error', onError);
    };
  // Re-run when the video element mounts (conditional on initialBufferReady/streamUrl).
  }, [infoHash, fileIdx, initialBufferReady, streamUrl]);

  // Fullscreen observer.
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const seekTo = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(v.duration || t, t));
      setStreamPosition(infoHash, fileIdx, v.currentTime);
    },
    [infoHash, fileIdx],
  );

  const setPlaybackRate = useCallback((r: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = r;
  }, []);

  const selectAudio = useCallback((id: string) => {
    const v = videoRef.current;
    if (!v?.audioTracks) return;
    for (let i = 0; i < v.audioTracks.length; i++) {
      v.audioTracks[i].enabled = (v.audioTracks[i].id || String(i)) === id;
    }
    setSelectedAudio(id);
  }, []);

  const selectNativeSub = useCallback((index: number) => {
    const v = videoRef.current;
    if (!v) return;
    setSelectedTrack(-1);
    setSelectedNativeSub(prev => {
      const next = prev === index ? -1 : index;
      for (let i = 0; i < v.textTracks.length; i++) {
        v.textTracks[i].mode = i === next ? 'showing' : 'hidden';
      }
      return next;
    });
  }, []);

  const handleSelectTrack = useCallback(
    async (i: number) => {
      // Clear any active native container text tracks.
      const v = videoRef.current;
      if (v) for (let j = 0; j < v.textTracks.length; j++) v.textTracks[j].mode = 'hidden';
      setSelectedNativeSub(-1);

      const track = tracks[i];
      if (!track) {
        setSelectedTrack(-1);
        return;
      }
      // Embedded or already-downloaded track: select immediately.
      if (track.sourceName !== 'OpenSubtitles' || track.url) {
        setSelectedTrack(i);
        setTrackState((prev) => { const m = new Map(prev); m.delete(i); return m; });
        return;
      }
      // OS track: trigger download.
      setSelectedTrack(i);
      setTrackState((prev) => new Map(prev).set(i, 'loading'));
      try {
        const res = await relaxClient.downloadSubtitle({ trackReference: track.trackReference });
        setTracks((prev) =>
          prev.map((t, idx) => (idx === i ? { ...t, url: res.url } : t)),
        );
        setTrackState((prev) => { const m = new Map(prev); m.delete(i); return m; });
      } catch (err) {
        const isQuota =
          err instanceof ConnectError && err.code === Code.ResourceExhausted;
        setTrackState((prev) => new Map(prev).set(i, isQuota ? 'quota' : 'error'));
      }
    },
    [tracks],
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={wake}
      onClick={(e) => {
        if (e.target === e.currentTarget) togglePlay();
      }}
      className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-black text-neutral-100"
    >
      {streamUrl && initialBufferReady ? (
        <video
          ref={videoRef}
          src={streamUrl}
          className="h-full w-full bg-black"
          autoPlay
          playsInline
          onClick={togglePlay}
        />
      ) : (
        <div className="absolute inset-0 bg-black" />
      )}

      {(!initialBufferReady || !streamUrl) && (
        <BufferingOverlay percent={initialBufferPct} />
      )}

      {videoError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/90">
          <div className="max-w-sm space-y-3 rounded-xl border border-red-900/60 bg-red-950/30 p-6 text-center text-sm text-neutral-200">
            <div className="text-base font-semibold">Playback failed</div>
            <p className="text-neutral-300">{videoError}</p>
            <button
              type="button"
              onClick={onBack}
              className="mt-1 cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {!playing && initialBufferReady && streamUrl && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className="pointer-events-auto absolute flex h-20 w-20 cursor-pointer items-center justify-center rounded-full bg-black/60 ring-1 ring-white/10 transition hover:bg-black/70"
        >
          <Play className="h-9 w-9 fill-white text-white" />
        </button>
      )}

      {activeCue && (
        <CueOverlay text={activeCue.text} style={style} shiftedForControls={showControls} />
      )}

      {/* Top bar */}
      <header
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-4 py-3 transition-opacity duration-200 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="pointer-events-auto flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={onBack}
            className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-neutral-200 transition hover:bg-white/10"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <span className="font-semibold text-white">{title}</span>
          {subtitle && <span className="text-neutral-400">·</span>}
          {subtitle && <span className="text-neutral-300">{subtitle}</span>}
          {(quality || sourceLabel) && (
            <span className="ml-2 flex items-center gap-2 text-xs text-neutral-400">
              {quality && <span className="text-neutral-300">{quality}</span>}
              {sourceLabel && <span>· {sourceLabel}</span>}
            </span>
          )}
        </div>
      </header>

      {reBuffering && initialBufferReady && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 px-4 py-2 text-xs text-neutral-200 ring-1 ring-white/10">
          Buffering…
        </div>
      )}

      {panel === 'subs' && (
        <SubtitlesPanel
          tracks={tracks}
          selected={selectedTrack}
          trackState={trackState}
          onSelect={(i) => void handleSelectTrack(i)}
          style={style}
          onStyleChange={setStyle}
          onClose={() => setPanel('none')}
          audioTracks={audioTracks}
          selectedAudio={selectedAudio}
          onSelectAudio={selectAudio}
          nativeSubTracks={nativeSubTracks}
          selectedNativeSub={selectedNativeSub}
          onSelectNativeSub={selectNativeSub}
        />
      )}
      {panel === 'speed' && (
        <SpeedPanel
          rate={rate}
          onSetRate={(r) => setPlaybackRate(r)}
          onClose={() => setPanel('none')}
        />
      )}
      {showStats && stats && (
        <StatsPanel stats={stats} onClose={() => setShowStats(false)} />
      )}

      {/* Bottom controls */}
      <footer
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-3 pt-6 transition-opacity duration-200 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <ProgressBar
          current={currentTime}
          duration={duration}
          buffered={bufferedEnd}
          onSeek={seekTo}
        />
        <div className="mt-2 flex items-center gap-3">
          <IconButton onClick={() => seekTo(currentTime - 10)} aria-label="Skip back">
            <SkipBack className="h-4 w-4" />
          </IconButton>
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow transition hover:bg-primary/90"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause className="h-5 w-5 fill-white" />
            ) : (
              <Play className="h-5 w-5 fill-white" />
            )}
          </button>
          <IconButton onClick={() => seekTo(currentTime + 10)} aria-label="Skip forward">
            <SkipForward className="h-4 w-4" />
          </IconButton>
          <VolumeControl
            volume={volume}
            muted={muted}
            onChange={(v) => {
              if (!videoRef.current) return;
              videoRef.current.volume = v;
              videoRef.current.muted = v === 0;
            }}
            onToggleMute={() => {
              if (!videoRef.current) return;
              videoRef.current.muted = !videoRef.current.muted;
            }}
          />
          <span className="text-xs tabular-nums text-neutral-300">
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowStats((v) => !v)}
            className="hidden cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-white/10 md:flex"
          >
            <span className="flex items-center gap-1">
              <ArrowUp className="h-3 w-3 text-accent" />
              {stats?.numSeeds ?? '—'}
            </span>
            <span className="flex items-center gap-1 text-neutral-400">
              / {stats?.numPeers ?? '—'}
            </span>
            <span className="text-neutral-400">·</span>
            <span className="text-neutral-200">{fmtSpeed(stats?.downloadSpeedBps ?? 0)}</span>
          </button>
          <button
            type="button"
            onClick={() => setPanel(panel === 'subs' ? 'none' : 'subs')}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-white/10"
            aria-label="Subtitles & playback"
          >
            <Subtitles className="h-4 w-4" />
            <span>
              {selectedTrack >= 0 ? tracks[selectedTrack]?.label ?? 'On' : 'Off'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPanel(panel === 'speed' ? 'none' : 'speed')}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-white/10"
            aria-label="Subtitle style"
          >
            <Settings className="h-4 w-4" />
            <span>{rate}×</span>
          </button>
          <IconButton onClick={toggleFullscreen} aria-label="Fullscreen">
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </IconButton>
        </div>
      </footer>
    </div>
  );
}

function BufferingOverlay({ percent }: { percent: number }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-4 text-center text-neutral-200">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-2 border-white/10" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent" />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">Buffering…</div>
          <div className="text-xs text-neutral-400">{percent}%</div>
        </div>
        <div className="h-1 w-48 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
  current,
  duration,
  buffered,
  onSeek,
}: {
  current: number;
  duration: number;
  buffered: number;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const playedPct = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const getSeekTime = (clientX: number) => {
    if (!ref.current || duration <= 0) return null;
    const rect = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  };
  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    const t = getSeekTime(e.clientX);
    if (t !== null) onSeek(t);
    const onMove = (ev: MouseEvent) => { const tt = getSeekTime(ev.clientX); if (tt !== null) onSeek(tt); };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  return (
    <div
      ref={ref}
      onMouseDown={handleMouseDown}
      onMouseMove={(e) => setHoverTime(getSeekTime(e.clientX))}
      onMouseLeave={() => setHoverTime(null)}
      className="group relative h-1.5 cursor-pointer rounded-full bg-white/15"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-white/25"
        style={{ width: `${bufferedPct}%` }}
      />
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-primary group-hover:bg-accent"
        style={{ width: `${playedPct}%` }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-accent opacity-0 ring-2 ring-black/60 transition group-hover:opacity-100"
        style={{ left: `${playedPct}%` }}
      />
      {hoverTime !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-xs tabular-nums text-white ring-1 ring-white/10"
          style={{ left: `${(hoverTime / duration) * 100}%` }}
        >
          {fmtTime(hoverTime)}
        </div>
      )}
    </div>
  );
}

function VolumeControl({
  volume,
  muted,
  onChange,
  onToggleMute,
}: {
  volume: number;
  muted: boolean;
  onChange: (v: number) => void;
  onToggleMute: () => void;
}) {
  const fillPct = (muted ? 0 : volume) * 100;
  return (
    <div className="group flex items-center gap-2">
      <IconButton onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
        {muted || volume === 0 ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </IconButton>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-20 cursor-pointer appearance-none rounded-full accent-accent"
        style={{ background: `linear-gradient(to right, var(--color-primary) ${fillPct}%, rgba(255,255,255,0.15) ${fillPct}%)` }}
        aria-label="Volume"
      />
    </div>
  );
}

function IconButton({
  children,
  onClick,
  'aria-label': aria,
}: {
  children: ReactNode;
  onClick: () => void;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      className="cursor-pointer rounded-md p-2 text-neutral-200 transition hover:bg-white/10"
    >
      {children}
    </button>
  );
}


function StatsPanel({
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

function SubtitlesPanel({
  tracks,
  selected,
  trackState,
  onSelect,
  style,
  onStyleChange,
  onClose,
  audioTracks,
  selectedAudio,
  onSelectAudio,
  nativeSubTracks,
  selectedNativeSub,
  onSelectNativeSub,
}: {
  tracks: SubtitleTrack[];
  selected: number;
  trackState: Map<number, TrackLoadState>;
  onSelect: (i: number) => void;
  style: SubtitleStyle;
  onStyleChange: (s: SubtitleStyle) => void;
  onClose: () => void;
  audioTracks: Array<{id: string; label: string; language: string}>;
  selectedAudio: string;
  onSelectAudio: (id: string) => void;
  nativeSubTracks: Array<{index: number; label: string; language: string}>;
  selectedNativeSub: number;
  onSelectNativeSub: (index: number) => void;
}) {
  const [view, setView] = useState<'tracks' | 'style'>('tracks');
  const bundledSubs = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.sourceName !== 'OpenSubtitles');
  const openSubs = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.sourceName === 'OpenSubtitles');
  const quotaHit = [...trackState.values()].some((s) => s === 'quota');
  const noSubs = nativeSubTracks.length === 0 && tracks.length === 0;

  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-20 w-72 rounded-xl border border-white/10 bg-surface-elevated/95 p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        {view === 'style' ? (
          <button type="button" onClick={() => setView('tracks')}
            className="cursor-pointer flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-100">
            ← Back
          </button>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Subtitles</span>
        )}
        <button type="button" onClick={onClose} className="cursor-pointer text-neutral-400 hover:text-neutral-100">×</button>
      </div>

      {view === 'tracks' ? (
        <div className="space-y-3">
          {/* Subtitle tracks */}
          <ul className="space-y-1">
            <PanelOption active={selected === -1 && selectedNativeSub === -1} onClick={() => onSelect(-1)}>Off</PanelOption>

            {nativeSubTracks.length > 0 && (
              <>
                <li className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Embedded</li>
                {nativeSubTracks.map(({ index, label, language }) => (
                  <li key={`native-${index}`}>
                    <button type="button" onClick={() => onSelectNativeSub(index)}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                        selectedNativeSub === index ? 'bg-primary/15 text-accent-light ring-1 ring-primary/30' : 'text-neutral-200 hover:bg-white/5'
                      }`}>
                      <span>{label || language}</span>
                      {selectedNativeSub === index && <Check className="h-4 w-4 text-accent" />}
                    </button>
                  </li>
                ))}
              </>
            )}

            {bundledSubs.length > 0 && (
              <>
                <li className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  {nativeSubTracks.length > 0 ? 'Bundled' : 'Embedded'}
                </li>
                {bundledSubs.map(({ t, i }) => (
                  <TrackOption key={`bundled-${i}`} track={t} index={i} selected={selected} loadState={trackState.get(i)} onSelect={onSelect} />
                ))}
              </>
            )}

            {openSubs.length > 0 && (
              <>
                <li className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">OpenSubtitles</li>
                {openSubs.map(({ t, i }) => (
                  <TrackOption key={`os-${t.trackReference}`} track={t} index={i} selected={selected} loadState={trackState.get(i)} onSelect={onSelect} />
                ))}
              </>
            )}

            {noSubs && (
              <li className="px-3 py-2 text-xs text-neutral-500">No subtitles available.</li>
            )}
          </ul>

          {quotaHit && (
            <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-300 ring-1 ring-amber-800/50">
              Subtitle download limit reached — try again tomorrow.
            </p>
          )}

          <button type="button" onClick={() => setView('style')} className="cursor-pointer text-xs text-accent hover:text-accent-light">
            Customize subtitle style →
          </button>

          {/* Audio tracks — only shown for multi-audio files (MKV etc) */}
          {audioTracks.length > 1 && (
            <div className="space-y-1 border-t border-white/10 pt-3">
              <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Audio</div>
              {audioTracks.map((at) => (
                <li key={at.id} className="list-none">
                  <button type="button" onClick={() => onSelectAudio(at.id)}
                    className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                      selectedAudio === at.id ? 'bg-primary/15 text-accent-light ring-1 ring-primary/30' : 'text-neutral-200 hover:bg-white/5'
                    }`}>
                    <span>{at.label || at.language}</span>
                    {selectedAudio === at.id && <Check className="h-4 w-4 text-accent" />}
                  </button>
                </li>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <StyleSlider label={`Font size — ${style.fontSize}px`} min={14} max={48} value={style.fontSize} onChange={(v) => onStyleChange({ ...style, fontSize: v })} />
          <div>
            <label className="block text-xs font-medium text-neutral-300">Color</label>
            <div className="mt-1 flex items-center gap-2">
              {['#ffffff', '#ffe45e', '#9fe1cb', '#5dcaa5', '#ff9d6c'].map((c) => (
                <button key={c} type="button" onClick={() => onStyleChange({ ...style, color: c })}
                  className={`cursor-pointer h-7 w-7 rounded-full ring-1 ring-white/10 transition ${style.color === c ? 'ring-2 ring-accent' : ''}`}
                  style={{ backgroundColor: c }} aria-label={`Color ${c}`} />
              ))}
              <input type="color" value={style.color} onChange={(e) => onStyleChange({ ...style, color: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent" aria-label="Custom color" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-300">Background</label>
            <div className="mt-1 flex items-center gap-1">
              {(['none', 'translucent', 'solid'] as const).map((b) => (
                <button key={b} type="button" onClick={() => onStyleChange({ ...style, background: b })}
                  className={`cursor-pointer flex-1 rounded-md px-2 py-1.5 text-xs capitalize transition ${style.background === b ? 'bg-primary text-white' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}`}>
                  {b}
                </button>
              ))}
            </div>
          </div>
          <StyleSlider label={`Position — ${style.bottomPercent}%`} min={0} max={40} value={style.bottomPercent} onChange={(v) => onStyleChange({ ...style, bottomPercent: v })} />
          <label className="flex cursor-pointer items-center justify-between text-xs text-neutral-300">
            <span>Outline / Shadow</span>
            <input type="checkbox" checked={style.outline} onChange={(e) => onStyleChange({ ...style, outline: e.target.checked })} className="h-4 w-4 accent-accent" />
          </label>
          <button type="button" onClick={() => onStyleChange(DEFAULT_STYLE)} className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-200">
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

function TrackOption({
  track,
  index,
  selected,
  loadState,
  onSelect,
}: {
  track: SubtitleTrack;
  index: number;
  selected: number;
  loadState: TrackLoadState | undefined;
  onSelect: (i: number) => void;
}) {
  const isActive = selected === index;
  const isLoading = loadState === 'loading';
  const isError = loadState === 'error';

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(index)}
        disabled={isLoading}
        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${
          isActive
            ? 'bg-primary/15 text-accent-light ring-1 ring-primary/30'
            : 'text-neutral-200 hover:bg-white/5'
        } ${isLoading ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}
      >
        <span>{track.label}</span>
        <span className="ml-2 shrink-0">
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
          {isError && (
            <span
              className="text-[10px] text-red-400 underline decoration-dotted"
              title="Failed to load — click to retry"
            >
              retry
            </span>
          )}
          {!isLoading && !isError && isActive && (
            <Check className="h-4 w-4 text-accent" />
          )}
        </span>
      </button>
    </li>
  );
}

function PanelOption({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition ${
          active
            ? 'bg-primary/15 text-accent-light ring-1 ring-primary/30'
            : 'text-neutral-200 hover:bg-white/5'
        }`}
      >
        <span>{children}</span>
        {active && <Check className="h-4 w-4 text-accent" />}
      </button>
    </li>
  );
}

function SpeedPanel({
  rate,
  onSetRate,
  onClose,
}: {
  rate: number;
  onSetRate: (r: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-20 w-56 rounded-xl border border-white/10 bg-surface-elevated/95 p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Playback Speed</span>
        <button type="button" onClick={onClose} className="cursor-pointer text-neutral-400 hover:text-neutral-100">×</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SPEEDS.map((s) => (
          <button key={s} type="button" onClick={() => onSetRate(s)}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition ${rate === s ? 'bg-primary text-white' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}`}>
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}

function StyleSlider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-300">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent"
      />
    </div>
  );
}

function CueOverlay({
  text,
  style,
  shiftedForControls,
}: {
  text: string;
  style: SubtitleStyle;
  shiftedForControls: boolean;
}) {
  const bg =
    style.background === 'translucent'
      ? 'rgba(0,0,0,0.55)'
      : style.background === 'solid'
        ? 'rgba(0,0,0,0.9)'
        : 'transparent';
  // Lift cues when controls are visible so they don't overlap the control bar.
  const bottomPct = shiftedForControls
    ? Math.max(style.bottomPercent, 12)
    : style.bottomPercent;
  const lines = text.split('\n');
  return (
    <div
      className="pointer-events-none absolute left-1/2 z-10 max-w-[80%] -translate-x-1/2 text-center"
      style={{ bottom: `${bottomPct}%` }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className="my-0.5 inline-block rounded px-2 py-0.5"
          style={{
            fontSize: `${style.fontSize}px`,
            color: style.color,
            backgroundColor: bg,
            textShadow: style.outline
              ? '0 0 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)'
              : 'none',
            fontWeight: 600,
            lineHeight: 1.35,
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${m}:${ss}`;
}

function fmtSpeed(bps: number): string {
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
