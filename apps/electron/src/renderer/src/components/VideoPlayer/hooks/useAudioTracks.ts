import { useCallback, useEffect, useState } from 'react';
import {
  getStreamAudioTracks,
  switchStreamAudio,
  type AudioTrack,
} from '../../../lib/torrent';

// Audio-track discovery and switching. Switching spins up a fresh ffmpeg pipe
// starting at the current display position, so the player keeps its apparent
// position while the new stream URL loads.
export function useAudioTracks({
  infoHash,
  fileIdx,
  initialBufferReady,
  displayTime,
  setStreamUrl,
  setSeekOffsetSeconds,
  setCurrentTime,
  setBufferedEnd,
  setAudioSwitching,
}: {
  infoHash: string;
  fileIdx: number;
  initialBufferReady: boolean;
  displayTime: number;
  setStreamUrl: (url: string | undefined) => void;
  setSeekOffsetSeconds: (s: number) => void;
  setCurrentTime: (t: number) => void;
  setBufferedEnd: (b: number) => void;
  setAudioSwitching: (v: boolean) => void;
}) {
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');

  // Load audio tracks once the buffer is ready.
  // ponytail: deps narrowed to what the body reads. The original shared an
  // effect with subtitle loading (which needs tmdbId/mediaType/season/episode);
  // those can't change without infoHash/fileIdx also changing, and the fetch
  // keys off infoHash/fileIdx anyway, so behavior is identical.
  useEffect(() => {
    if (!initialBufferReady) return;
    let cancelled = false;
    void getStreamAudioTracks(infoHash, fileIdx).then((at) => {
      if (cancelled) return;
      const def = at.find((a) => a.isDefault) ?? at[0];
      console.info('[audio] backend tracks', {
        infoHash, fileIdx,
        count: at.length,
        tracks: at.map(({ id, typeIndex, language, codec, channels, isDefault }) => ({
          id, typeIndex, language, codec, channels, isDefault,
        })),
        defaultId: def?.id ?? null,
      });
      setAudioTracks(at);
      if (def) setSelectedAudioId(def.id);
    }).catch((err) => {
      if (cancelled) return;
      console.warn('[audio] backend tracks failed', err);
      setAudioTracks([]);
    });
    return () => { cancelled = true; };
  }, [infoHash, fileIdx, initialBufferReady]);

  const selectAudio = useCallback(async (track: AudioTrack) => {
    if (track.id === selectedAudioId) return;
    console.info('[audio] switch requested', {
      id: track.id, typeIndex: track.typeIndex, language: track.language,
      codec: track.codec, channels: track.channels, resumeAt: displayTime,
    });
    setSelectedAudioId(track.id);
    setAudioSwitching(true);
    // Resume playback from where we are now — the new ffmpeg pipe starts at
    // displayTime, so the player keeps its apparent position.
    const resumeAt = displayTime;
    setSeekOffsetSeconds(resumeAt);
    setCurrentTime(0);
    setBufferedEnd(0);
    const url = await switchStreamAudio(infoHash, fileIdx, track.typeIndex, resumeAt);
    console.info('[audio] switch result', { trackId: track.id, url });
    if (!url) {
      setAudioSwitching(false);
      return;
    }
    setStreamUrl(url);
  }, [infoHash, fileIdx, selectedAudioId, displayTime]);

  return { audioTracks, selectedAudioId, selectAudio };
}
