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
  Headphones,
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
  getStreamAudioTracks,
  getStreamSubtitles,
  markCacheFinished,
  seekStreamUrl,
  setStreamPosition,
  switchStreamAudio,
  useTorrentStats,
  type AudioTrack,
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
  resumeSeconds?: number;
  magnetUri?: string;
  posterUrl?: string;
  onBack: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const HIDE_DELAY_MS = 3000;

// Order in which sourceNames appear in the subtitle menu. Empty groups are omitted.
const SUBTITLE_GROUP_ORDER = ['Embedded', 'Embedded (MKV)', 'OpenSubtitles', 'YIFYSubs'] as const;

// ponytail: English-only. Drop non-English tracks at ingest so they don't
// show up in the menu, auto-select, or get downloaded. If multi-language
// support is ever wanted, lift this into a user setting.
const isEnglish = (lang: string | undefined) =>
  !!lang && /^en([_-]|$)|^eng$/i.test(lang);

type TrackLoadState = 'loading' | 'error' | 'quota';
type PanelKind = 'none' | 'subs' | 'audio' | 'speed';

export function VideoPlayer(props: VideoPlayerProps) {
  const {
    infoHash, fileIdx, streamUrl: initialStreamUrl, title, subtitle, quality, sourceLabel,
    tmdbId, mediaType, season, episode, resumeSeconds, magnetUri, posterUrl, onBack,
  } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionThrottle = useRef<number>(0);
  // Watch-progress persistence is independent from the engine prefetch hint
  // — the engine wants frequent updates; we only persist every 10s.
  const persistThrottle = useRef<number>(0);
  const resumeAppliedRef = useRef<boolean>(false);
  // ponytail: most viewers skip credits — treat >=90% watched as finished and
  // stop persisting. Bump if false-positives on short content; lower if people
  // complain that long credits keep titles in Continue Watching.
  const finishedRef = useRef<boolean>(false);

  // The currently-served stream URL. Starts at the prop, replaced when the
  // audio track changes or the user seeks in remux mode (the main process
  // gives us a new URL with ?t={seconds} so <video> reloads at that offset).
  const [streamUrl, setStreamUrl] = useState<string | undefined>(initialStreamUrl);
  useEffect(() => setStreamUrl(initialStreamUrl), [initialStreamUrl]);

  // Wall-clock time the current stream started at (in source-file seconds).
  // In remux mode v.currentTime is 0..(remaining duration), so display time =
  // v.currentTime + seekOffsetSeconds. In passthrough mode it stays 0.
  const [seekOffsetSeconds, setSeekOffsetSeconds] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [rate, setRate] = useState(1);
  const [panel, setPanel] = useState<PanelKind>('none');
  const [showStats, setShowStats] = useState(false);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<number>(-1);
  const [style, setStyle] = useState<SubtitleStyle>(loadSubtitleStyle);
  const [reBuffering, setReBuffering] = useState(false);
  const [trackState, setTrackState] = useState<Map<number, TrackLoadState>>(new Map());
  const [videoError, setVideoError] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [audioSwitching, setAudioSwitching] = useState(false);
  // Transient HUD shown when the user scrolls to change volume.
  const [volumeHud, setVolumeHud] = useState<number | null>(null);
  const volumeHudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stats = useTorrentStats(infoHash);
  const initialBufferReady = stats?.bufferingComplete ?? false;
  const initialBufferPct = Math.round((stats?.initialBufferProgress ?? 0) * 100);
  const needsRemux = stats?.needsRemux ?? false;

  // Always trust probe duration when available — the remux pipe's container
  // header reports only the *remaining* duration from the seek point.
  const effectiveDuration =
    stats?.durationSeconds && stats.durationSeconds > 0
      ? stats.durationSeconds
      : Number.isFinite(duration) && duration > 0
        ? duration
        : 0;
  const displayTime = Math.min(effectiveDuration || Infinity, currentTime + seekOffsetSeconds);

  // Only use the URL if the track has been resolved (either embedded or downloaded).
  const activeTrackUrl = selectedTrack >= 0 && !trackState.get(selectedTrack)
    ? (tracks[selectedTrack]?.url || null)
    : null;
  const cues = useParsedVtt(activeTrackUrl);
  const activeCue = useMemo(() => activeCueAt(cues, currentTime), [cues, currentTime]);

  // Load subtitles + audio tracks once the buffer is ready. Subtitle search:
  // local embedded (loose .srt/.vtt + MKV-extracted) first, then external
  // providers (OpenSubtitles + YIFYSubs, aggregated by the backend).
  useEffect(() => {
    if (!initialBufferReady) return;
    void getStreamSubtitles(infoHash, fileIdx).then((embedded) => {
      setTracks(embedded.filter((t) => isEnglish(t.language)));
      if (tmdbId > 0) {
        void relaxClient
          .searchSubtitles({ tmdbId, mediaType, season, episode })
          .then((res) => {
            const external: SubtitleTrack[] = (res.tracks ?? [])
              .filter((t) => isEnglish(t.language))
              .map((t) => ({
                language: t.language,
                label: t.label,
                url: t.url,
                format: t.format,
                sourceName: t.sourceName,
                trackReference: t.trackReference,
                // External tracks are always extractable (provider downloads SRT/VTT).
                supported: true,
              }));
            setTracks((prev) => [...prev, ...external]);
          })
          .catch(() => {
            // Non-critical: leave embedded-only tracks as-is.
          });
      }
    }).catch(() => setTracks([]));

    void getStreamAudioTracks(infoHash, fileIdx).then((at) => {
      setAudioTracks(at);
      const def = at.find((a) => a.isDefault) ?? at[0];
      if (def) setSelectedAudioId(def.id);
    }).catch(() => setAudioTracks([]));
  }, [infoHash, fileIdx, initialBufferReady, tmdbId, mediaType, season, episode]);

  // MKV-embedded subs are probe-gated and the backend no longer waits for
  // the probe before returning. Once the probe lands (durationSeconds > 0),
  // re-fetch and merge MKV tracks in — de-duped by trackReference so we
  // don't shadow already-present external entries.
  const probeReady = (stats?.durationSeconds ?? 0) > 0;
  useEffect(() => {
    if (!initialBufferReady || !probeReady) return;
    void getStreamSubtitles(infoHash, fileIdx).then((embedded) => {
      const mkv = embedded.filter(
        (t) => isEnglish(t.language) && t.sourceName === 'Embedded (MKV)',
      );
      if (mkv.length === 0) return;
      setTracks((prev) => {
        const seen = new Set(prev.map((t) => t.trackReference));
        return [...prev, ...mkv.filter((t) => !seen.has(t.trackReference))];
      });
    }).catch(() => { /* noop */ });
  }, [infoHash, fileIdx, initialBufferReady, probeReady]);

  // Persist subtitle style.
  useEffect(() => {
    saveSubtitleStyle(style);
  }, [style]);

  // Auto-hide controls. Hide while playing OR while buffering (no video yet);
  // keep them visible only when the user has explicitly paused.
  const wake = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (!v || !v.paused) setShowControls(false);
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

  // togglePlay + seekTo are declared up here so the keyboard handler below
  // can capture them; original placement was further down but TS rightly
  // complains about temporal dead zone in the effect's deps.
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  // Single click toggles play/pause, double click toggles fullscreen. The
  // browser fires both onClick and onDoubleClick when you double-click, so
  // we defer the play toggle long enough to swallow it when the second
  // click arrives.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePlayerClick = useCallback(() => {
    if (panel !== 'none' || showStats) {
      setPanel('none');
      setShowStats(false);
      return;
    }
    if (clickTimerRef.current) return;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      togglePlay();
    }, 220);
  }, [togglePlay, panel, showStats]);
  const handlePlayerDoubleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    toggleFullscreen();
  }, [toggleFullscreen]);

  const seekTo = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      const clamped = Math.max(0, Math.min(effectiveDuration || t, t));
      setStreamPosition(infoHash, fileIdx, clamped);
      if (needsRemux) {
        // Remux mode: each seek is a fresh ffmpeg invocation. Swap src to
        // /stream/.../?t={clamped} and re-anchor the display offset; the new
        // stream itself starts at currentTime=0.
        setSeekOffsetSeconds(clamped);
        setCurrentTime(0);
        setBufferedEnd(0);
        void seekStreamUrl(infoHash, fileIdx, clamped).then((url) => {
          if (url) setStreamUrl(url);
        });
        return;
      }
      v.currentTime = clamped;
    },
    [infoHash, fileIdx, needsRemux, effectiveDuration],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      // Arrows always seek — even with a button focused — so the player
      // doesn't fight focus-driven keyboard navigation. Other shortcuts still
      // defer to input/select focus.
      // ponytail: keyboard shortcuts never wake the controls — mouse-only.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(displayTime + (e.key === 'ArrowRight' ? 10 : -10));
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen, seekTo, displayTime]);

  // Track video element state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

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
        // Send absolute time so webtorrent prioritises the right pieces — in
        // remux mode v.currentTime is local to the current pipe.
        setStreamPosition(infoHash, fileIdx, v.currentTime + seekOffsetSeconds);
      }
      // Persist watch progress every 10s. Only after metadata lands and we
      // have a real duration — the backend ignores updates without one.
      if (
        magnetUri &&
        tmdbId > 0 &&
        v.duration > 0 &&
        now - persistThrottle.current > 10_000
      ) {
        persistThrottle.current = now;
        const abs = v.currentTime + seekOffsetSeconds;
        const dur = effectiveDuration || v.duration;
        if (!finishedRef.current && abs / dur >= 0.9) {
          finishedRef.current = true;
          void relaxClient.deleteWatchProgress({
            mediaId: String(tmdbId),
            mediaType,
            season,
            episode,
          }).catch(() => {});
          // Tell the engine to wipe the cached files on stop (next navigate-back).
          void markCacheFinished(infoHash);
        } else if (!finishedRef.current) {
          void relaxClient.upsertWatchProgress({
            progress: {
              mediaId: String(tmdbId),
              mediaType,
              title,
              posterUrl: posterUrl ?? '',
              season,
              episode,
              positionSeconds: abs,
              durationSeconds: v.duration,
              infoHash,
              fileIdx,
              magnetUri,
            },
          }).catch(() => {});
        }
      }
    };
    const onEnded = () => {
      if (tmdbId > 0) {
        void relaxClient.deleteWatchProgress({
          mediaId: String(tmdbId),
          mediaType,
          season,
          episode,
        }).catch(() => {});
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
    const onCanPlay = () => {
      setReBuffering(false);
      setAudioSwitching(false);
    };
    const onVolume = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const onRate = () => setRate(v.playbackRate);
    const onMeta = () => {
      setDuration(v.duration || 0);
      // Apply resume position once on the first playable load. Subsequent
      // src swaps (audio change / remux seek) keep their explicit offsets
      // via seekOffsetSeconds.
      if (!resumeAppliedRef.current && resumeSeconds && resumeSeconds > 0) {
        resumeAppliedRef.current = true;
        if (needsRemux) {
          // Remux mode: seekTo will fire a new ?t= URL; until then leave the
          // display offset where it lands.
          seekTo(resumeSeconds);
        } else {
          try { v.currentTime = resumeSeconds; } catch { /* noop */ }
        }
      }
      // After a src swap (audio change / remux seek), keep playing.
      if (v.paused) void v.play();
    };
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
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onError);
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
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', onError);
    };
  }, [
    infoHash, fileIdx, initialBufferReady, streamUrl,
    seekOffsetSeconds, magnetUri, tmdbId, mediaType, title, posterUrl,
    season, episode, resumeSeconds, needsRemux, seekTo,
  ]);

  // Fullscreen observer.
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Mouse-wheel volume. Needs a non-passive listener — React's synthetic
  // onWheel is passive and can't preventDefault the page scroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = videoRef.current;
      if (!v) return;
      const next = Math.max(0, Math.min(1, v.volume + (e.deltaY > 0 ? -0.05 : 0.05)));
      v.volume = next;
      v.muted = next === 0;
      setVolumeHud(next);
      if (volumeHudTimer.current) clearTimeout(volumeHudTimer.current);
      volumeHudTimer.current = setTimeout(() => setVolumeHud(null), 900);
      wake();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wake]);

  const setPlaybackRate = useCallback((r: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = r;
  }, []);

  const selectAudio = useCallback(async (track: AudioTrack) => {
    if (track.id === selectedAudioId) return;
    setSelectedAudioId(track.id);
    setAudioSwitching(true);
    // Resume playback from where we are now — the new ffmpeg pipe starts at
    // displayTime, so the player keeps its apparent position.
    const resumeAt = displayTime;
    setSeekOffsetSeconds(resumeAt);
    setCurrentTime(0);
    setBufferedEnd(0);
    const url = await switchStreamAudio(infoHash, fileIdx, track.typeIndex, resumeAt);
    if (!url) {
      setAudioSwitching(false);
      return;
    }
    setStreamUrl(url);
  }, [infoHash, fileIdx, selectedAudioId, displayTime]);

  const handleSelectTrack = useCallback(
    async (i: number) => {
      const track = tracks[i];
      if (!track) {
        setSelectedTrack(-1);
        return;
      }
      // Unsupported (e.g. PGS) — can't render. Click is a no-op.
      if (track.supported === false) return;

      // Already-resolved URL (loose embedded, MKV-extracted, or previously
      // downloaded external) — select immediately.
      if (track.url) {
        setSelectedTrack(i);
        setTrackState((prev) => { const m = new Map(prev); m.delete(i); return m; });
        return;
      }
      // External provider (OpenSubtitles / YIFYSubs) — lazy download.
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

  // Auto-pick the first supported subtitle once tracks land. Runs exactly
  // once per session — if the user picks Off afterwards we don't re-enable
  // when external providers append their results later.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.supported !== false);
    if (idx < 0) return;
    autoSelectedRef.current = true;
    void handleSelectTrack(idx);
  }, [tracks, handleSelectTrack]);

  return (
    <div
      ref={containerRef}
      onMouseMove={wake}
      onClick={(e) => {
        if (e.target === e.currentTarget) handlePlayerClick();
      }}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) handlePlayerDoubleClick();
      }}
      className={`fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-black text-neutral-100 ${
        showControls ? '' : 'cursor-none'
      }`}
    >
      {streamUrl && initialBufferReady ? (
        <video
          ref={videoRef}
          src={streamUrl}
          className="h-full w-full bg-black"
          autoPlay
          playsInline
          onClick={handlePlayerClick}
          onDoubleClick={handlePlayerDoubleClick}
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

      {!playing && initialBufferReady && streamUrl && !audioSwitching && (
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

      {/* Top bar — z-30 so it sits above the buffering overlay (z-20). */}
      <header
        className={`pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-4 py-3 transition-opacity duration-200 ${
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

      {(reBuffering || audioSwitching) && initialBufferReady && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 px-4 py-2 text-xs text-neutral-200 ring-1 ring-white/10">
          {audioSwitching ? 'Switching audio…' : 'Buffering…'}
        </div>
      )}

      {volumeHud !== null && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full bg-black/75 px-5 py-3 text-sm text-neutral-100 ring-1 ring-white/10">
          {volumeHud === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(volumeHud * 100)}%` }} />
          </div>
          <span className="tabular-nums">{Math.round(volumeHud * 100)}%</span>
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
        />
      )}
      {panel === 'audio' && (
        <AudioPanel
          tracks={audioTracks}
          selectedId={selectedAudioId}
          onSelect={(t) => void selectAudio(t)}
          onClose={() => setPanel('none')}
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
          current={displayTime}
          duration={effectiveDuration}
          buffered={bufferedEnd + seekOffsetSeconds}
          onSeek={seekTo}
        />
        <div className="mt-2 flex items-center gap-3">
          <IconButton onClick={() => seekTo(displayTime - 10)} aria-label="Skip back">
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
          <IconButton onClick={() => seekTo(displayTime + 10)} aria-label="Skip forward">
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
            {fmtTime(displayTime)} / {fmtTime(effectiveDuration)}
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
          {audioTracks.length > 1 && (
            <button
              type="button"
              onClick={() => setPanel(panel === 'audio' ? 'none' : 'audio')}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-white/10"
              aria-label="Audio track"
            >
              <Headphones className="h-4 w-4" />
              <span>{audioTracks.find((a) => a.id === selectedAudioId)?.language?.toUpperCase() ?? 'Audio'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setPanel(panel === 'subs' ? 'none' : 'subs')}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-white/10"
            aria-label="Subtitles"
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
            aria-label="Playback speed"
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
}: {
  tracks: SubtitleTrack[];
  selected: number;
  trackState: Map<number, TrackLoadState>;
  onSelect: (i: number) => void;
  style: SubtitleStyle;
  onStyleChange: (s: SubtitleStyle) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<'tracks' | 'style'>('tracks');
  const quotaHit = [...trackState.values()].some((s) => s === 'quota');

  // Group tracks by sourceName. Unknown sources fall under "Other" at the end.
  const byGroup = new Map<string, Array<{ t: SubtitleTrack; i: number }>>();
  tracks.forEach((t, i) => {
    const arr = byGroup.get(t.sourceName) ?? [];
    arr.push({ t, i });
    byGroup.set(t.sourceName, arr);
  });
  const orderedGroups = [
    ...SUBTITLE_GROUP_ORDER.map((k) => [k, byGroup.get(k) ?? []] as const).filter(([, v]) => v.length > 0),
    ...[...byGroup.entries()].filter(([k]) => !(SUBTITLE_GROUP_ORDER as readonly string[]).includes(k)),
  ];

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
          <ul className="max-h-96 space-y-1 overflow-y-auto pr-1">
            <PanelOption active={selected === -1} onClick={() => onSelect(-1)}>Off</PanelOption>

            {orderedGroups.map(([groupName, items]) => (
              <div key={groupName}>
                <li className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  {groupName}
                </li>
                {items.map(({ t, i }) => (
                  <TrackOption
                    key={`${groupName}-${t.trackReference || i}`}
                    track={t}
                    index={i}
                    selected={selected}
                    loadState={trackState.get(i)}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ))}

            {tracks.length === 0 && (
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

function AudioPanel({
  tracks,
  selectedId,
  onSelect,
  onClose,
}: {
  tracks: AudioTrack[];
  selectedId: string;
  onSelect: (t: AudioTrack) => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-20 w-72 rounded-xl border border-white/10 bg-surface-elevated/95 p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Audio</span>
        <button type="button" onClick={onClose} className="cursor-pointer text-neutral-400 hover:text-neutral-100">×</button>
      </div>
      <ul className="space-y-1">
        {tracks.map((t) => {
          const active = t.id === selectedId;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                  active ? 'bg-primary/15 text-accent-light ring-1 ring-primary/30' : 'text-neutral-200 hover:bg-white/5'
                }`}
              >
                <span className="text-left">
                  <span className="block">{t.label}</span>
                  {t.isDefault && <span className="text-[10px] uppercase text-neutral-500">Default</span>}
                </span>
                {active && <Check className="h-4 w-4 text-accent" />}
              </button>
            </li>
          );
        })}
        {tracks.length === 0 && (
          <li className="px-3 py-2 text-xs text-neutral-500">No audio tracks detected.</li>
        )}
      </ul>
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
  const isUnsupported = track.supported === false;
  const disabled = isLoading || isUnsupported;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(index)}
        disabled={disabled}
        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${
          isActive
            ? 'bg-primary/15 text-accent-light ring-1 ring-primary/30'
            : isUnsupported
              ? 'text-neutral-500'
              : 'text-neutral-200 hover:bg-white/5'
        } ${isLoading ? 'cursor-wait opacity-70' : isUnsupported ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className="truncate text-left">
          {track.label}
          {isUnsupported && <span className="ml-2 text-[10px] uppercase">(not supported)</span>}
        </span>
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
