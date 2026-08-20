import { Volume2, VolumeX } from 'lucide-react';
import { IconButton } from './IconButton';

export function VolumeControl({
  volume,
  muted,
  onChange,
  onToggleMute,
}: {
  volume: number;
  muted: boolean;
  onChange: (v: number) => void;
  onToggleMute: () => void;
}) {
  const fillPct = (muted ? 0 : volume) * 100;
  return (
    <div className="group flex items-center gap-2">
      <IconButton onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
        {muted || volume === 0 ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </IconButton>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-20 cursor-pointer appearance-none rounded-full accent-accent"
        style={{ background: `linear-gradient(to right, var(--color-primary) ${fillPct}%, rgba(255,255,255,0.15) ${fillPct}%)` }}
        aria-label="Volume"
      />
    </div>
  );
}
