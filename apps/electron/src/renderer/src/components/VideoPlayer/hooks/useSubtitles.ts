import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import { type MediaType } from '@relax/types';
import {
  activeCueAt,
  loadSubtitleStyle,
  saveSubtitleStyle,
  srtToVtt,
  useParsedVtt,
  type SubtitleStyle,
} from '../../../lib/subtitle';
import { getStreamSubtitles, type SubtitleTrack } from '../../../lib/torrent';
import { relaxClient } from '../../../lib/client';
import { isEnglish, type PanelKind, type TrackLoadState } from '../types';

// All subtitle state and side effects: track discovery (embedded + external
// providers + probe-gated MKV), selection/lazy-download, local file loading,
// per-track offset calibration, style persistence, and active-cue derivation.
export function useSubtitles({
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
}: {
  infoHash: string;
  fileIdx: number;
  initialBufferReady: boolean;
  probeReady: boolean;
  tmdbId: number;
  mediaType: MediaType;
  season: number;
  episode: number;
  displayTime: number;
  showToast: (msg: string) => void;
  setPanel: (p: PanelKind) => void;
}) {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<number>(-1);
  const [style, setStyle] = useState<SubtitleStyle>(loadSubtitleStyle);
  // ponytail: per-session only — resets on track change. Persisting per-file would need a keyed store; not worth it until users ask.
  const [subOffsetMs, setSubOffsetMs] = useState(0);
  const [trackState, setTrackState] = useState<Map<number, TrackLoadState>>(new Map());

  // Only use the URL if the track has been resolved (either embedded or downloaded).
  const activeTrackUrl = selectedTrack >= 0 && !trackState.get(selectedTrack)
    ? (tracks[selectedTrack]?.url || null)
    : null;
  const cues = useParsedVtt(activeTrackUrl);
  // Match cues against the true source-file position. In remux mode the
  // <video> element's currentTime is pipe-local (resets to 0 after a seek),
  // so displayTime (= currentTime + seekOffsetSeconds) is the correct clock.
  const activeCue = useMemo(
    () => activeCueAt(cues, displayTime - subOffsetMs / 1000),
    [cues, displayTime, subOffsetMs],
  );

  // Reset offset when the user picks a different track — calibration is per-track.
  useEffect(() => {
    setSubOffsetMs(0);
  }, [selectedTrack]);

  // Load subtitles once the buffer is ready. Subtitle search: local embedded
  // (loose .srt/.vtt + MKV-extracted) first, then external providers
  // (OpenSubtitles + YIFYSubs, aggregated by the backend).
  useEffect(() => {
    if (!initialBufferReady) return;
    let cancelled = false;
    void getStreamSubtitles(infoHash, fileIdx).then((embedded) => {
      if (cancelled) return;
      setTracks(embedded.filter((t) => isEnglish(t.language)));
      if (tmdbId > 0) {
        void relaxClient
          .searchSubtitles({ tmdbId, mediaType, season, episode })
          .then((res) => {
            if (cancelled) return;
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
    }).catch(() => { if (!cancelled) setTracks([]); });
    return () => { cancelled = true; };
  }, [infoHash, fileIdx, initialBufferReady, tmdbId, mediaType, season, episode]);

  // MKV-embedded subs are probe-gated and the backend no longer waits for
  // the probe before returning. Once the probe lands (durationSeconds > 0),
  // re-fetch and merge MKV tracks in — de-duped by trackReference so we
  // don't shadow already-present external entries.
  useEffect(() => {
    if (!initialBufferReady || !probeReady) return;
    let cancelled = false;
    void getStreamSubtitles(infoHash, fileIdx).then((embedded) => {
      if (cancelled) return;
      const mkv = embedded.filter(
        (t) => isEnglish(t.language) && t.sourceName === 'Embedded (MKV)',
      );
      if (mkv.length === 0) return;
      setTracks((prev) => {
        const seen = new Set(prev.map((t) => t.trackReference));
        return [...prev, ...mkv.filter((t) => !seen.has(t.trackReference))];
      });
    }).catch(() => { /* noop */ });
    return () => { cancelled = true; };
  }, [infoHash, fileIdx, initialBufferReady, probeReady]);

  // Persist subtitle style.
  useEffect(() => {
    saveSubtitleStyle(style);
  }, [style]);

  const handleSelectTrack = useCallback(
    async (i: number) => {
      setPanel('none');
      const track = tracks[i];
      if (!track) {
        setSelectedTrack(-1);
        showToast('Subtitles off');
        return;
      }
      // Unsupported (e.g. PGS) — can't render. Click is a no-op.
      if (track.supported === false) return;

      // Already-resolved URL (loose embedded, MKV-extracted, or previously
      // downloaded external) — select immediately.
      if (track.url) {
        setSelectedTrack(i);
        setTrackState((prev) => { const m = new Map(prev); m.delete(i); return m; });
        showToast(`Subtitles loaded: ${track.label}`);
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
        showToast(`Subtitles loaded: ${track.label}`);
      } catch (err) {
        const isQuota =
          err instanceof ConnectError && err.code === Code.ResourceExhausted;
        setTrackState((prev) => new Map(prev).set(i, isQuota ? 'quota' : 'error'));
      }
    },
    [tracks, showToast, setPanel],
  );

  // Local file-load: convert SRT→VTT in-renderer, wrap in a blob URL, inject
  // as a new track, and select it. Blob URLs are revoked on unmount.
  const localBlobUrlsRef = useRef<string[]>([]);
  useEffect(() => () => {
    for (const url of localBlobUrlsRef.current) URL.revokeObjectURL(url);
  }, []);
  // ponytail: always-current tracks ref so the file-load callback doesn't
  // need tracks in deps (would re-create on every track append).
  const tracksRef = useRef(tracks);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  const handleLoadLocalSubtitle = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const vtt = /\.vtt$/i.test(file.name) ? text : srtToVtt(text);
      const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      localBlobUrlsRef.current.push(url);
      const newTrack: SubtitleTrack = {
        language: 'en',
        label: file.name,
        url,
        format: 'vtt',
        sourceName: 'Local',
        trackReference: `local:${url}`,
        supported: true,
      };
      const newIndex = tracksRef.current.length;
      console.log('[subtitle] local track', { file: file.name, url, newIndex, vttPreview: vtt.slice(0, 120) });
      setTracks((prev) => [...prev, newTrack]);
      setSelectedTrack(newIndex);
      showToast(`Subtitles loaded: ${file.name}`);
    } catch (err) {
      console.warn('[subtitle] local file load failed', err);
      showToast('Failed to load subtitle file');
    }
  }, [showToast]);

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

  return {
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
  };
}
