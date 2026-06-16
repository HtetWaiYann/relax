// ffmpeg / ffprobe helpers used by the local stream server.
//
// Codec support matrix in Electron's Chromium:
//   video:  H.264 (avc1)        — pass through
//           HEVC (hevc, h265)   — pass through (Electron 21+)
//           VP9, AV1            — pass through
//   audio:  AAC, MP3            — pass through
//           Opus, Vorbis, FLAC  — pass through
//           AC3, EAC3 (Dolby)   — UNSUPPORTED, transcode to AAC
//           DTS, DCA, TrueHD    — UNSUPPORTED, transcode to AAC
//           MLP, PCM            — UNSUPPORTED, transcode to AAC
//
// When transcoding is needed we remux through ffmpeg: video is stream-copied
// (no re-encode, near-zero CPU) and only audio is transcoded to AAC. This is
// the standard "no-audio in Electron MKV" workaround used by Stremio/Jellyfin.
//
// Seeking under transcode is implemented by spawning a fresh ffmpeg with
// `-ss` per byte-range request. We map the requested byte offset to a time
// offset using duration/total-size — Chromium's seek bar still works.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const execFileAsync = promisify(execFile);

// ffmpeg-static exports a default string; ffprobe-static exports { path }.
export const FFMPEG_PATH = (ffmpegStatic as unknown as string) ?? '';
export const FFPROBE_PATH = (ffprobeStatic as { path: string }).path ?? '';

const UNSUPPORTED_AUDIO_CODECS = new Set([
  'ac3', 'eac3', 'dts', 'dca', 'truehd', 'mlp',
]);

export function audioNeedsTranscode(codec: string | undefined): boolean {
  if (!codec) return false;
  const c = codec.toLowerCase();
  if (c.startsWith('pcm_')) return true;
  return UNSUPPORTED_AUDIO_CODECS.has(c);
}

// Subtitle codecs we can extract to WebVTT via ffmpeg.
// PGS / DVDsub / HDMV are bitmap formats — Chromium can't render them
// without an OCR pass; we surface them in the UI as unsupported.
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text',
]);

export function subtitleIsExtractable(codec: string | undefined): boolean {
  if (!codec) return false;
  return TEXT_SUBTITLE_CODECS.has(codec.toLowerCase());
}

export interface ProbeStream {
  // Absolute index in the source container.
  index: number;
  // Relative index within streams of the same type (-map 0:a:N etc).
  typeIndex: number;
  codecType: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment' | string;
  codecName: string;
  language: string;
  title: string;
  channels?: number;
  isDefault: boolean;
}

export interface ProbeResult {
  durationSeconds: number;
  bitRateBps: number;
  streams: ProbeStream[];
}

export async function probeFile(filePath: string): Promise<ProbeResult | null> {
  if (!FFPROBE_PATH) {
    console.warn('[ffmpeg] FFPROBE_PATH not resolved');
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_PATH,
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
      { maxBuffer: 8 * 1024 * 1024, timeout: 8000 },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = JSON.parse(stdout);
    const typeCounts: Record<string, number> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streams: ProbeStream[] = (json.streams ?? []).map((s: any) => {
      const codecType = String(s.codec_type ?? '');
      const typeIndex = typeCounts[codecType] ?? 0;
      typeCounts[codecType] = typeIndex + 1;
      return {
        index: Number(s.index ?? 0),
        typeIndex,
        codecType,
        codecName: String(s.codec_name ?? ''),
        language: String(s.tags?.language ?? ''),
        title: String(s.tags?.title ?? ''),
        channels: typeof s.channels === 'number' ? s.channels : undefined,
        isDefault: Number(s.disposition?.default ?? 0) === 1,
      };
    });
    return {
      durationSeconds: Number(json.format?.duration ?? 0),
      bitRateBps: Number(json.format?.bit_rate ?? 0),
      streams,
    };
  } catch (err) {
    console.warn('[ffmpeg] probe failed', err);
    return null;
  }
}

export function audioStreams(probe: ProbeResult | null): ProbeStream[] {
  return probe?.streams.filter((s) => s.codecType === 'audio') ?? [];
}

export function subtitleStreams(probe: ProbeResult | null): ProbeStream[] {
  return probe?.streams.filter((s) => s.codecType === 'subtitle') ?? [];
}

// pickDefaultAudio prefers a Chromium-supported codec when one exists, even
// over the file's flagged default — that way a BluRay rip with English-AC3 +
// English-AAC plays via passthrough (no transcode latency, native seeking,
// container metadata intact) instead of forcing a remux for no reason.
export function pickDefaultAudio(probe: ProbeResult | null): ProbeStream | null {
  const audios = audioStreams(probe);
  if (audios.length === 0) return null;
  const flagged = audios.find((a) => a.isDefault) ?? audios[0];
  if (!audioNeedsTranscode(flagged.codecName)) return flagged;
  const supported = audios.find((a) => !audioNeedsTranscode(a.codecName));
  return supported ?? flagged;
}

// Spawn ffmpeg to remux: copy video, transcode (or copy) the selected audio
// stream, output Matroska on stdout. Seek with -ss before -i for fast input
// seeking (no full-file decode).
export function spawnRemux(opts: {
  filePath: string;
  audioTypeIdx: number;     // 0-based among audio streams (-> -map 0:a:N)
  startSeconds: number;
  transcodeAudio: boolean;
}) {
  const args: string[] = ['-hide_banner', '-loglevel', 'warning'];
  if (opts.startSeconds > 0) args.push('-ss', opts.startSeconds.toFixed(3));
  args.push(
    '-i', opts.filePath,
    '-map', '0:v:0',
    '-map', `0:a:${opts.audioTypeIdx}?`,
    '-c:v', 'copy',
    '-c:a', opts.transcodeAudio ? 'aac' : 'copy',
  );
  if (opts.transcodeAudio) args.push('-b:a', '192k', '-ac', '2');
  // Fragmented MP4 over a pipe writes a real moov atom up front with track
  // duration metadata — Matroska from a pipe can't (the SegmentInfo Duration
  // is only patched in on close, which never happens for live remux), which
  // makes Chromium report `video.duration = NaN` and disables seeking entirely.
  args.push(
    '-f', 'mp4',
    '-movflags', 'empty_moov+default_base_moof+frag_keyframe+omit_tfhd_offset',
    'pipe:1',
  );
  return spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

// Extract a single subtitle stream as WebVTT on stdout.
export function spawnSubtitleExtract(
  filePath: string,
  subtitleTypeIdx: number,
) {
  return spawn(FFMPEG_PATH, [
    '-hide_banner', '-loglevel', 'error',
    '-i', filePath,
    '-map', `0:s:${subtitleTypeIdx}`,
    '-f', 'webvtt',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}
