import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// Volume boost past 100% (<video>.volume caps at 1) and night mode (dynamic
// range compression: lifts dialogue and quiet scenes, tames explosions —
// film mixes are far quieter than music, and 5.1→stereo downmixes lose more).
//
//   <video> → source → [night: compressor → makeup] → boost → limiter → out
//
// Built lazily the first time either is enabled: createMediaElementSource
// permanently reroutes the element's audio, so anyone who never touches these
// keeps Chromium's native output path. Needs crossOrigin on the <video> (the
// stream server sends ACAO: *), otherwise the source node outputs silence.
export const BOOST_LEVELS = [1, 1.25, 1.5, 2] as const;
// ~+9 dB after compression: dialogue around -27 LUFS lands near -18 while
// peaks stay under 0 dBFS (threshold -30, ratio 4).
const NIGHT_MAKEUP_GAIN = 2.8;

const FX_KEY = 'relax.audioFx.v1';
interface AudioFx { boost: number; night: boolean }
function loadFx(): AudioFx {
  const defaults: AudioFx = { boost: 1, night: false };
  try {
    const raw = localStorage.getItem(FX_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<AudioFx>) } : defaults;
  } catch {
    return defaults;
  }
}

interface Graph {
  el: HTMLVideoElement;
  ctx: AudioContext;
  src: MediaElementAudioSourceNode;
  comp: DynamicsCompressorNode;
  makeup: GainNode;
  boost: GainNode;
  limiter: DynamicsCompressorNode;
}

function buildGraph(el: HTMLVideoElement): Graph {
  const ctx = new AudioContext();
  const src = ctx.createMediaElementSource(el);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -30;
  comp.knee.value = 20;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.25;
  const makeup = ctx.createGain();
  makeup.gain.value = NIGHT_MAKEUP_GAIN;
  const boost = ctx.createGain();
  // Brick-wall-ish limiter so 200% boost doesn't hard-clip into distortion.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  boost.connect(limiter);
  limiter.connect(ctx.destination);
  return { el, ctx, src, comp, makeup, boost, limiter };
}

export function useAudioFx(
  videoRef: RefObject<HTMLVideoElement | null>,
  // The <video> only mounts once the stream is ready; re-run then.
  videoReady: boolean,
) {
  const [fx, setFx] = useState<AudioFx>(loadFx);
  useEffect(() => {
    try { localStorage.setItem(FX_KEY, JSON.stringify(fx)); } catch { /* storage disabled */ }
  }, [fx]);

  const graphRef = useRef<Graph | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let g = graphRef.current;
    if (!g || g.el !== v) {
      if (fx.boost <= 1 && !fx.night) return; // stay on the native path
      void g?.ctx.close();
      g = buildGraph(v);
      graphRef.current = g;
    }
    g.src.disconnect();
    g.comp.disconnect();
    g.makeup.disconnect();
    if (fx.night) {
      g.src.connect(g.comp);
      g.comp.connect(g.makeup);
      g.makeup.connect(g.boost);
    } else {
      g.src.connect(g.boost);
    }
    g.boost.gain.value = fx.boost;
    void g.ctx.resume();
  }, [videoRef, videoReady, fx]);

  // A context created before any user gesture can start suspended; playback
  // starting is a safe point to resume it.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => { void graphRef.current?.ctx.resume(); };
    v.addEventListener('play', onPlay);
    return () => v.removeEventListener('play', onPlay);
  }, [videoRef, videoReady]);

  useEffect(() => () => { void graphRef.current?.ctx.close(); }, []);

  const setBoost = useCallback((boost: number) => setFx((f) => ({ ...f, boost })), []);
  const setNight = useCallback((night: boolean) => setFx((f) => ({ ...f, night })), []);
  return { boost: fx.boost, night: fx.night, setBoost, setNight };
}
