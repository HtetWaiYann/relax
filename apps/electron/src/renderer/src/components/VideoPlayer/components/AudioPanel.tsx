import { Check } from 'lucide-react';
import { type AudioTrack } from '../../../lib/torrent';

export function AudioPanel({
  tracks,
  selectedId,
  onSelect,
  onClose,
}: {
  tracks: AudioTrack[];
  selectedId: string;
  onSelect: (t: AudioTrack) => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-20 w-72 rounded-xl border border-white/10 bg-surface-elevated/95 p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Audio</span>
        <button type="button" onClick={onClose} className="cursor-pointer text-neutral-400 hover:text-neutral-100">×</button>
      </div>
      <ul className="space-y-1">
        {tracks.map((t) => {
          const active = t.id === selectedId;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                  active ? 'bg-primary/15 text-accent-light ring-1 ring-primary/30' : 'text-neutral-200 hover:bg-white/5'
                }`}
              >
                <span className="text-left">
                  <span className="block">{t.label}</span>
                  {t.isDefault && <span className="text-[10px] uppercase text-neutral-500">Default</span>}
                </span>
                {active && <Check className="h-4 w-4 text-accent" />}
              </button>
            </li>
          );
        })}
        {tracks.length === 0 && (
          <li className="px-3 py-2 text-xs text-neutral-500">No audio tracks detected.</li>
        )}
      </ul>
    </div>
  );
}
