import { useMemo } from 'react';
import { type SubtitleStyle } from '../../../lib/subtitle';
import { balanceCueLines } from '../utils/cue';

export function CueOverlay({
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
  const lines = useMemo(
    () => balanceCueLines(text, style.fontSize),
    [text, style.fontSize],
  );
  return (
    <div
      className="pointer-events-none absolute left-1/2 z-10 flex max-w-[80%] -translate-x-1/2 flex-col items-center gap-1"
      style={{ bottom: `${bottomPct}%` }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className="rounded px-2 py-0.5 text-center break-words"
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
