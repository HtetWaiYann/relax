import { SPEEDS } from '../types';

export function SpeedPanel({
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
