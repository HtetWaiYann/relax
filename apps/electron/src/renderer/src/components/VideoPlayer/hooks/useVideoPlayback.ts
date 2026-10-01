import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { type MediaType } from '@relax/types';
import { markCacheFinished, seekStreamUrl, setStreamPosition } from '../../../lib/torrent';
import { relaxClient } from '../../../lib/client';

// The core <video> driver: playback state, the timeline (seek offset in remux
// mode), the big media-event effect (progress persistence, decode-retry,
// resume, teardown), and the seek/play/rate controls. Kept as one unit because
// these pieces are mutually dependent — splitting them would thread a dozen
// setters between hooks for no gain.
export function useVideoPlayback({
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
  statsDurationSeconds,
  needsRemux,
  initialBufferReady,
  setShowControls,
  setAudioSwitching,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  infoHash: string;
  fileIdx: number;
  initialStreamUrl: string | undefined;
  resumeSeconds: number | undefined;
  magnetUri: string | undefined;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterUrl: string | undefined;
  season: number;
  episode: number;
  statsDurationSeconds: number | undefined;
  needsRemux: boolean;
  initialBufferReady: boolean;
  setShowControls: (v: boolean) => void;
  setAudioSwitching: (v: boolean) => void;
}) {
  const positionThrottle = useRef<number>(0);
  // Watch-progress persistence is independent from the engine prefetch hint
  // — the engine wants frequent updates; we only persist every 10s.
  const persistThrottle = useRef<number>(0);
  const resumeAppliedRef = useRef<boolean>(false);
  // ponytail: decode errors are usually a corrupt piece in the current
  // buffer — nudge the engine to re-fetch and reload <video> up to 3 times
  // before surfacing the error. Reset per new stream URL.
  const decodeRetryRef = useRef<number>(0);
  const retrySeekRef = useRef<number | null>(null);
  useEffect(() => { decodeRetryRef.current = 0; }, [initialStreamUrl]);
  // ponytail: most viewers skip credits — treat >=90% watched as finished and
  // stop persisting. Bump if false-positives on short content; lower if people
  // complain that long credits keep titles in Continue Watching.
  const finishedRef = useRef<boolean>(false);
  // Latest "save progress now" closure from the media-event effect, so pause
  // and unmount can flush without waiting for the 10s throttle.
  const persistRef = useRef<(() => void) | null>(null);
  const mountedVideoRef = useRef<HTMLVideoElement | null>(null);
  // Seeks are debounced: a seek-bar drag or a held arrow key would otherwise
  // spawn one ffmpeg pipe (remux) or one position hint per event.
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remux: true from a seek until the new pipe can play. The old pipe keeps
  // emitting timeupdate meanwhile, which would show/persist a bogus position.
  const seekPendingRef = useRef<boolean>(false);
  // Premature remux `ended` recovery: where the last one happened + how many
  // times in a row the pipe died at roughly that spot.
  const earlyEndRef = useRef<{ at: number; count: number }>({ at: -1, count: 0 });
  useEffect(() => () => { if (seekTimerRef.current) clearTimeout(seekTimerRef.current); }, []);

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
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [rate, setRate] = useState(1);
  const [reBuffering, setReBuffering] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Always trust probe duration when available — the remux pipe's container
  // header reports only the *remaining* duration from the seek point.
  const effectiveDuration =
    statsDurationSeconds && statsDurationSeconds > 0
      ? statsDurationSeconds
      : Number.isFinite(duration) && duration > 0
        ? duration
        : 0;
  const displayTime = Math.min(effectiveDuration || Infinity, currentTime + seekOffsetSeconds);

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
      const clamped = Math.max(0, Math.min(effectiveDuration || t, t));
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      if (needsRemux) {
        // Remux mode: each seek is a fresh ffmpeg invocation. Swap src to
        // /stream/.../?t={clamped} and re-anchor the display offset; the new
        // stream itself starts at currentTime=0. The UI moves immediately;
        // the pipe swap waits until the seeking settles.
        seekPendingRef.current = true;
        setSeekOffsetSeconds(clamped);
        setCurrentTime(0);
        setBufferedEnd(0);
        // <video>'s `waiting` event doesn't fire on src swap (it goes
        // emptied→loadstart→canplay), so force the buffering pill on until
        // canplay clears it.
        setReBuffering(true);
        seekTimerRef.current = setTimeout(() => {
          seekTimerRef.current = null;
          setStreamPosition(infoHash, fileIdx, clamped);
          void seekStreamUrl(infoHash, fileIdx, clamped).then((url) => {
            if (url) setStreamUrl(url);
          });
        }, 300);
        return;
      }
      // Passthrough: Chromium cancels superseded seeks itself; only the
      // engine hint needs debouncing.
      v.currentTime = clamped;
      seekTimerRef.current = setTimeout(() => {
        seekTimerRef.current = null;
        setStreamPosition(infoHash, fileIdx, clamped);
      }, 150);
    },
    [infoHash, fileIdx, needsRemux, effectiveDuration],
  );

  // Track video element state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    mountedVideoRef.current = v;

    // In remux mode v.duration is NaN/Infinity (live pipe) or only the
    // remaining part from the seek point — the probe duration is the truth.
    const durationNow = () =>
      effectiveDuration || (Number.isFinite(v.duration) ? v.duration : 0);
    const saveProgress = (positionSeconds: number, durationSeconds: number) => {
      // The backend ignores updates without a real duration.
      if (!magnetUri || tmdbId <= 0 || durationSeconds <= 0) return;
      void relaxClient.upsertWatchProgress({
        progress: {
          mediaId: String(tmdbId),
          mediaType,
          title,
          posterUrl: posterUrl ?? '',
          season,
          episode,
          positionSeconds,
          durationSeconds,
          infoHash,
          fileIdx,
          magnetUri,
        },
      }).catch(() => {});
    };
    // Mark watched (position = duration) instead of deleting — keeps a ✓
    // record for the episode picker. Ratio 1.0 stays out of Continue
    // Watching (backend hides rows past FinishedRatio = 0.97).
    const markFinished = () => {
      if (!magnetUri || tmdbId <= 0) return;
      finishedRef.current = true;
      const dur = durationNow();
      saveProgress(dur, dur);
      // Tell the engine to wipe the cached files on stop (next navigate-back).
      void markCacheFinished(infoHash);
    };
    const persistNow = () => {
      if (finishedRef.current || seekPendingRef.current) return;
      const dur = durationNow();
      if (dur <= 0) return;
      const abs = v.currentTime + seekOffsetSeconds;
      if (abs / dur >= 0.9) markFinished();
      else saveProgress(abs, dur);
    };
    persistRef.current = persistNow;

    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      setShowControls(true);
      persistNow();
    };
    const onTime = () => {
      if (seekPendingRef.current) return;
      setCurrentTime(v.currentTime);
      const now = performance.now();
      if (now - positionThrottle.current > 1500) {
        positionThrottle.current = now;
        // Send absolute time so webtorrent prioritises the right pieces — in
        // remux mode v.currentTime is local to the current pipe.
        setStreamPosition(infoHash, fileIdx, v.currentTime + seekOffsetSeconds);
      }
      if (now - persistThrottle.current > 10_000) {
        persistThrottle.current = now;
        persistNow();
      }
    };
    const onEnded = () => {
      const abs = v.currentTime + seekOffsetSeconds;
      const dur = durationNow();
      // A remux pipe that closes well before the real end (ffmpeg hit a
      // zero-filled piece, socket hiccup) fires a spurious `ended`. Restart
      // the pipe from here instead of marking the title watched; give up
      // after 3 deaths within ~5s of each other.
      if (needsRemux && dur > 0 && abs < dur * 0.9) {
        const last = earlyEndRef.current;
        const count = Math.abs(abs - last.at) < 5 ? last.count + 1 : 1;
        earlyEndRef.current = { at: abs, count };
        console.warn('[video] remux pipe ended early', { abs, dur, count });
        if (count <= 3) {
          seekTo(abs);
          return;
        }
        setVideoError('Stream ended unexpectedly. Try seeking ahead or a different source.');
        return;
      }
      markFinished();
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
      seekPendingRef.current = false;
      setReBuffering(false);
      setAudioSwitching(false);
      decodeRetryRef.current = 0;
      // ponytail: chromium-only counters. If audioBytesDecoded stays 0 while
      // videoBytesDecoded climbs, the audio codec isn't being decoded (likely
      // EAC3/DTS/TrueHD passthrough). Swap to a probed track or enable remux.
      const ext = v as HTMLVideoElement & {
        webkitAudioDecodedByteCount?: number;
        webkitVideoDecodedByteCount?: number;
      };
      console.info('[audio] canplay', {
        muted: v.muted,
        volume: v.volume,
        audioBytesDecoded: ext.webkitAudioDecodedByteCount ?? 0,
        videoBytesDecoded: ext.webkitVideoDecodedByteCount ?? 0,
      });
    };
    const onVolume = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const onRate = () => setRate(v.playbackRate);
    const onMeta = () => {
      setDuration(v.duration || 0);
      const ext = v as HTMLVideoElement & {
        webkitAudioDecodedByteCount?: number;
        webkitVideoDecodedByteCount?: number;
        audioTracks?: { length: number };
      };
      console.info('[audio] loadedmetadata', {
        src: v.currentSrc,
        duration: v.duration,
        muted: v.muted,
        volume: v.volume,
        elementAudioTrackCount: ext.audioTracks?.length ?? 0,
        audioBytesDecoded: ext.webkitAudioDecodedByteCount ?? 0,
        videoBytesDecoded: ext.webkitVideoDecodedByteCount ?? 0,
      });
      // Decode-retry path: restore the failed timestamp before play resumes.
      if (retrySeekRef.current !== null) {
        try { v.currentTime = retrySeekRef.current; } catch { /* noop */ }
        retrySeekRef.current = null;
      } else if (!resumeAppliedRef.current && resumeSeconds && resumeSeconds > 0) {
        // Apply resume position once on the first playable load. Subsequent
        // src swaps (audio change / remux seek) keep their explicit offsets
        // via seekOffsetSeconds.
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
      if (v.paused) {
        // TEMP DIAGNOSTIC
        v.play()
          .then(() => console.info('[video] play() after meta OK'))
          .catch((e) => console.warn('[video] play() after meta REJECTED', e?.name, e?.message));
      }
    };
    const onError = () => {
      const code = v.error?.code;
      console.warn('[video] error', { code, msg: v.error?.message, src: v.currentSrc, retry: decodeRetryRef.current });
      // Decode errors: re-fetch bytes around the failure point and reload.
      // Keep the buffering pill on so the user sees we're working on it.
      if (code === MediaError.MEDIA_ERR_DECODE && decodeRetryRef.current < 3) {
        decodeRetryRef.current++;
        const resumeAt = v.currentTime + seekOffsetSeconds;
        setReBuffering(true);
        setStreamPosition(infoHash, fileIdx, resumeAt);
        if (needsRemux) {
          // seekTo fires a new ?t= URL → fresh ffmpeg pipe with re-fetched pieces.
          seekTo(resumeAt);
        } else {
          // Passthrough: reload the media element and seek back via retrySeekRef.
          retrySeekRef.current = resumeAt;
          try { v.load(); } catch { /* noop */ }
        }
        return;
      }
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

  // Release the video element on unmount: drop the HTTP connection to the
  // local stream server, otherwise the open socket lingers until the next GC.
  // The <video> mounts only after the initial buffer, so it's read from
  // mountedVideoRef (set by the event effect) — videoRef is already null by
  // the time unmount cleanups run.
  useEffect(() => () => {
    const v = mountedVideoRef.current;
    if (!v) return;
    // Flush progress before tearing down — otherwise leaving loses up to
    // the 10s persist throttle.
    persistRef.current?.();
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* noop */ }
  }, []);

  const setPlaybackRate = useCallback((r: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = r;
  }, []);

  return {
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
  };
}
