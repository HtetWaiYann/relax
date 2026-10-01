import { SPEEDS } from '../types';
import { BOOST_LEVELS } from '../hooks/useAudioFx';

const segment = (active: boolean) =>
  `cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition ${
    active ? 'bg-primary text-white' : 'bg-white/5 text-neutral-300 hover:bg-white/10'
  }`;

// Playback speed + audio (volume boost, night mode).
export function SpeedPanel({
  rate,
  onSetRate,
  boost,
  onSetBoost,
  night,
  onSetNight,
  onClose,
}: {
  rate: number;
  onSetRate: (r: number) => void;
  boost: number;
  onSetBoost: (b: number) => void;
  night: boolean;
  onSetNight: (on: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-20 w-64 rounded-xl border border-white/10 bg-surface-elevated/95 p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Playback Speed</span>
        <button type="button" onClick={onClose} className="cursor-pointer text-neutral-400 hover:text-neutral-100">×</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SPEEDS.map((s) => (
          <button key={s} type="button" onClick={() => onSetRate(s)} className={segment(rate === s)}>
            {s}×
          </button>
        ))}
      </div>

      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Audio</div>
      <div className="mb-1.5 text-xs text-neutral-300">Volume boost</div>
      <div className="grid grid-cols-4 gap-1.5">
        {BOOST_LEVELS.map((b) => (
          <button key={b} type="button" onClick={() => onSetBoost(b)} className={`${segment(boost === b)} px-1`}>
            {Math.round(b * 100)}%
          </button>
        ))}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={night}
        onClick={() => onSetNight(!night)}
        className="mt-3 flex w-full cursor-pointer items-center justify-between gap-3 rounded-md bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
      >
        <span>
          <span className="block text-xs text-neutral-200">Night mode</span>
          <span className="block text-[11px] text-neutral-500">Louder dialogue, softer explosions</span>
        </span>
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${night ? 'bg-primary' : 'bg-white/15'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left] ${night ? 'left-[18px]' : 'left-0.5'}`}
          />
        </span>
      </button>
    </div>
  );
}
