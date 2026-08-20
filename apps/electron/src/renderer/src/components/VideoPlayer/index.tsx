import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronLeft,
  Headphones,
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
  X,
} from 'lucide-react';
import {
  type PanelKind,
  type VideoPlayerProps,
} from './types';
import { useTorrentStats } from '../../lib/torrent';
import { fmtSpeed, fmtTime } from './utils/format';
import { AudioPanel } from './components/AudioPanel';
import { BufferingOverlay } from './components/BufferingOverlay';
import { CueOverlay } from './components/CueOverlay';
import { IconButton } from './components/IconButton';
import { ProgressBar } from './components/ProgressBar';
import { SpeedPanel } from './components/SpeedPanel';
import { StatsPanel } from './components/StatsPanel';
import { SubtitlesPanel } from './components/SubtitlesPanel';
import { VolumeControl } from './components/VolumeControl';
import { useAudioTracks } from './hooks/useAudioTracks';
import { useAutoHideControls } from './hooks/useAutoHideControls';
import { useFullscreen } from './hooks/useFullscreen';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useSubtitles } from './hooks/useSubtitles';
import { useToast } from './hooks/useToast';
import { useVideoPlayback } from './hooks/useVideoPlayback';
import { useWheelVolume } from './hooks/useWheelVolume';

export function VideoPlayer(props: VideoPlayerProps) {
  const {
    infoHash, fileIdx, streamUrl: initialStreamUrl, title, subtitle, quality, sourceLabel,
    tmdbId, mediaType, season, episode, resumeSeconds, magnetUri, posterUrl, onBack,
  } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<PanelKind>('none');
  const [audioSwitching, setAudioSwitching] = useState(false);
  const { toast, setToast, showToast } = useToast();

  const stats = useTorrentStats(infoHash);
  const initialBufferReady = stats?.bufferingComplete ?? false;
  const initialBufferPct = Math.round((stats?.initialBufferProgress ?? 0) * 100);
  const needsRemux = stats?.needsRemux ?? false;
  const probeReady = (stats?.durationSeconds ?? 0) > 0;

  const { showControls, setShowControls, wake } = useAutoHideControls(videoRef);
  const { fullscreen, toggleFullscreen } = useFullscreen(containerRef);

  const {
    streamUrl,
    setStreamUrl,
    seekOffsetSeconds,
    setSeekOffsetSeconds,
    currentTime,
    setCurrentTime,
    volume,
    setVolume,
    muted,
    setMuted,
    bufferedEnd,
    setBufferedEnd,
    rate,
    playing,
    reBuffering,
    videoError,
    effectiveDuration,
    displayTime,
    seekTo,
    togglePlay,
    setPlaybackRate,
  } = useVideoPlayback({
    videoRef,
    infoHash,
    fileIdx,
    initialStreamUrl,
    resumeSeconds,
    magnetUri,
    tmdbId,
    mediaType,
    title,
    posterUrl,
    season,
    episode,
    statsDurationSeconds: stats?.durationSeconds,
    needsRemux,
    initialBufferReady,
    setShowControls,
    setAudioSwitching,
  });

  const {
    tracks,
    selectedTrack,
    trackState,
    style,
    setStyle,
    subOffsetMs,
    setSubOffsetMs,
    activeCue,
    handleSelectTrack,
    handleLoadLocalSubtitle,
  } = useSubtitles({
    infoHash,
    fileIdx,
    initialBufferReady,
    probeReady,
    tmdbId,
    mediaType,
    season,
    episode,
    displayTime,
    showToast,
    setPanel,
  });

  const {
    audioTracks,
    selectedAudioId,
    selectAudio,
  } = useAudioTracks({
    infoHash,
    fileIdx,
    initialBufferReady,
    displayTime,
    setStreamUrl,
    setSeekOffsetSeconds,
    setCurrentTime,
    setBufferedEnd,
    setAudioSwitching,
  });

  // Single click toggles play/pause, double click toggles fullscreen. The
  // browser fires both onClick and onDoubleClick when you double-click, so
  // we defer the play toggle long enough to swallow it when the second
  // click arrives.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); }, []);
  const handlePlayerClick = useCallback(() => {
    if (panel !== 'none') {
      setPanel('none');
      return;
    }
    if (clickTimerRef.current) return;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      togglePlay();
    }, 220);
  }, [togglePlay, panel]);
  const handlePlayerDoubleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    toggleFullscreen();
  }, [toggleFullscreen]);

  useKeyboardShortcuts({
    videoRef,
    seekTo,
    togglePlay,
    toggleFullscreen,
    displayTime,
    setVolume,
    setMuted,
  });

  const { volumeHud } = useWheelVolume({ containerRef, videoRef, panel, wake });

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
        <BufferingOverlay
          percent={initialBufferPct}
          title={title}
          subtitle={subtitle}
          quality={quality}
          sourceLabel={sourceLabel}
          posterUrl={posterUrl}
          stats={stats}
          onBack={onBack}
        />
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

      {toast && (
        <div className="pointer-events-auto absolute right-4 top-4 z-40 flex items-center gap-2 rounded-lg bg-black/80 px-3 py-2 text-sm text-neutral-100 shadow-2xl ring-1 ring-white/10">
          <Check className="h-4 w-4 text-accent" />
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="ml-1 cursor-pointer rounded p-0.5 text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
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
          onLoadLocal={(f) => void handleLoadLocalSubtitle(f)}
          style={style}
          onStyleChange={setStyle}
          offsetMs={subOffsetMs}
          onOffsetChange={setSubOffsetMs}
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
      {panel === 'stats' && stats && (
        <StatsPanel stats={stats} onClose={() => setPanel('none')} />
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
            onClick={() => setPanel(panel === 'stats' ? 'none' : 'stats')}
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
