// ponytail: module-level canvas, reused across cues — measureText is cheap
// but the canvas isn't free to allocate. Stale on window resize until the
// next cue change; add a ResizeObserver if it ever bothers anyone.
const cueMeasureCanvas =
  typeof document !== 'undefined' ? document.createElement('canvas') : null;

export function balanceCueLines(text: string, fontSize: number): string[] {
  const joined = text.replace(/\s+/g, ' ').trim();
  if (!joined) return [];
  const ctx = cueMeasureCanvas?.getContext('2d');
  if (!ctx) return [joined];
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  // 80% of the viewport minus the cue div's px-2 padding (8px each side).
  const budget = window.innerWidth * 0.8 - 16;
  if (ctx.measureText(joined).width <= budget) return [joined];
  const words = joined.split(' ');
  if (words.length < 2) return [joined];
  // Pick the word boundary that yields the most width-balanced halves.
  let bestIdx = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(' ');
    const right = words.slice(i).join(' ');
    const diff = Math.abs(
      ctx.measureText(left).width - ctx.measureText(right).width,
    );
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return [
    words.slice(0, bestIdx).join(' '),
    words.slice(bestIdx).join(' '),
  ];
}
