import { useRef, useState, type ReactNode } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { type SubtitleTrack } from '../../../lib/torrent';
import { DEFAULT_STYLE, type SubtitleStyle } from '../../../lib/subtitle';
import { SUBTITLE_GROUP_ORDER, type TrackLoadState } from '../types';

export function SubtitlesPanel({
  tracks,
  selected,
  trackState,
  onSelect,
  onLoadLocal,
  style,
  onStyleChange,
  offsetMs,
  onOffsetChange,
  onClose,
}: {
  tracks: SubtitleTrack[];
  selected: number;
  trackState: Map<number, TrackLoadState>;
  onSelect: (i: number) => void;
  onLoadLocal: (f: File) => void;
  style: SubtitleStyle;
  onStyleChange: (s: SubtitleStyle) => void;
  offsetMs: number;
  onOffsetChange: (ms: number) => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [view, setView] = useState<'tracks' | 'style'>('tracks');
  const quotaHit = [...trackState.values()].some((s) => s === 'quota');

  // Group tracks by sourceName. Unknown sources fall under "Other" at the end.
  const byGroup = new Map<string, Array<{ t: SubtitleTrack; i: number }>>();
  tracks.forEach((t, i) => {
    const arr = byGroup.get(t.sourceName) ?? [];
    arr.push({ t, i });
    byGroup.set(t.sourceName, arr);
  });
  const orderedGroups = [
    ...SUBTITLE_GROUP_ORDER.map((k) => [k, byGroup.get(k) ?? []] as const).filter(([, v]) => v.length > 0),
    ...[...byGroup.entries()].filter(([k]) => !(SUBTITLE_GROUP_ORDER as readonly string[]).includes(k)),
  ];

  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-20 w-72 rounded-xl border border-white/10 bg-surface-elevated/95 p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        {view === 'style' ? (
          <button type="button" onClick={() => setView('tracks')}
            className="cursor-pointer flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-100">
            ← Back
          </button>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Subtitles</span>
        )}
        <button type="button" onClick={onClose} className="cursor-pointer text-neutral-400 hover:text-neutral-100">×</button>
      </div>

      {view === 'tracks' ? (
        <div className="space-y-3">
          <ul className="max-h-96 space-y-1 overflow-y-auto pr-1">
            <PanelOption active={selected === -1} onClick={() => onSelect(-1)}>Off</PanelOption>

            {orderedGroups.map(([groupName, items]) => (
              <div key={groupName}>
                <li className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  {groupName}
                </li>
                {items.map(({ t, i }) => (
                  <TrackOption
                    key={`${groupName}-${t.trackReference || i}`}
                    track={t}
                    index={i}
                    selected={selected}
                    loadState={trackState.get(i)}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ))}

            {tracks.length === 0 && (
              <li className="px-3 py-2 text-xs text-neutral-500">No subtitles available.</li>
            )}
          </ul>

          {quotaHit && (
            <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-300 ring-1 ring-amber-800/50">
              Subtitle download limit reached — try again tomorrow.
            </p>
          )}

          {selected >= 0 && (
            <SubtitleOffsetControl offsetMs={offsetMs} onChange={onOffsetChange} />
          )}

          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-200">
              Load from device…
            </button>
            <button type="button" onClick={() => setView('style')}
              className="cursor-pointer text-xs text-accent hover:text-accent-light">
              Customize style →
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLoadLocal(f);
              e.target.value = ''; // allow reselecting the same file
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <StyleSlider label={`Font size — ${style.fontSize}px`} min={14} max={48} value={style.fontSize} onChange={(v) => onStyleChange({ ...style, fontSize: v })} />
          <div>
            <label className="block text-xs font-medium text-neutral-300">Color</label>
            <div className="mt-1 flex items-center gap-2">
              {['#ffffff', '#ffe45e', '#9fe1cb', '#5dcaa5', '#ff9d6c'].map((c) => (
                <button key={c} type="button" onClick={() => onStyleChange({ ...style, color: c })}
                  className={`cursor-pointer h-7 w-7 rounded-full ring-1 ring-white/10 transition ${style.color === c ? 'ring-2 ring-accent' : ''}`}
                  style={{ backgroundColor: c }} aria-label={`Color ${c}`} />
              ))}
              <input type="color" value={style.color} onChange={(e) => onStyleChange({ ...style, color: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent" aria-label="Custom color" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-300">Background</label>
            <div className="mt-1 flex items-center gap-1">
              {(['none', 'translucent', 'solid'] as const).map((b) => (
                <button key={b} type="button" onClick={() => onStyleChange({ ...style, background: b })}
                  className={`cursor-pointer flex-1 rounded-md px-2 py-1.5 text-xs capitalize transition ${style.background === b ? 'bg-primary text-white' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}`}>
                  {b}
                </button>
              ))}
            </div>
          </div>
          <StyleSlider label={`Position — ${style.bottomPercent}%`} min={0} max={40} value={style.bottomPercent} onChange={(v) => onStyleChange({ ...style, bottomPercent: v })} />
          <label className="flex cursor-pointer items-center justify-between text-xs text-neutral-300">
            <span>Outline / Shadow</span>
            <input type="checkbox" checked={style.outline} onChange={(e) => onStyleChange({ ...style, outline: e.target.checked })} className="h-4 w-4 accent-accent" />
          </label>
          <button type="button" onClick={() => onStyleChange(DEFAULT_STYLE)} className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-200">
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

function TrackOption({
  track,
  index,
  selected,
  loadState,
  onSelect,
}: {
  track: SubtitleTrack;
  index: number;
  selected: number;
  loadState: TrackLoadState | undefined;
  onSelect: (i: number) => void;
}) {
  const isActive = selected === index;
  const isLoading = loadState === 'loading';
  const isError = loadState === 'error';
  const isUnsupported = track.supported === false;
  const disabled = isLoading || isUnsupported;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(index)}
        disabled={disabled}
        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${
          isActive
            ? 'bg-primary/15 text-accent-light ring-1 ring-primary/30'
            : isUnsupported
              ? 'text-neutral-500'
              : 'text-neutral-200 hover:bg-white/5'
        } ${isLoading ? 'cursor-wait opacity-70' : isUnsupported ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className="truncate text-left">
          {track.label}
          {isUnsupported && <span className="ml-2 text-[10px] uppercase">(not supported)</span>}
        </span>
        <span className="ml-2 shrink-0">
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
          {isError && (
            <span
              className="text-[10px] text-red-400 underline decoration-dotted"
              title="Failed to load — click to retry"
            >
              retry
            </span>
          )}
          {!isLoading && !isError && isActive && (
            <Check className="h-4 w-4 text-accent" />
          )}
        </span>
      </button>
    </li>
  );
}

function PanelOption({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition ${
          active
            ? 'bg-primary/15 text-accent-light ring-1 ring-primary/30'
            : 'text-neutral-200 hover:bg-white/5'
        }`}
      >
        <span>{children}</span>
        {active && <Check className="h-4 w-4 text-accent" />}
      </button>
    </li>
  );
}

function SubtitleOffsetControl({
  offsetMs,
  onChange,
}: {
  offsetMs: number;
  onChange: (ms: number) => void;
}) {
  const formatted = `${offsetMs >= 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s`;
  // Positive = subtitles appear later than original; negative = earlier.
  const STEP = 100;
  const BIG_STEP = 500;
  return (
    <div className="rounded-md bg-white/5 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-300">Subtitle delay</span>
        <span className="text-xs tabular-nums text-neutral-200">{formatted}</span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(offsetMs - BIG_STEP)}
          className="cursor-pointer flex-1 rounded-md bg-white/5 px-2 py-1 text-xs text-neutral-200 hover:bg-white/10"
          title="Earlier 0.5s">−0.5s</button>
        <button type="button" onClick={() => onChange(offsetMs - STEP)}
          className="cursor-pointer flex-1 rounded-md bg-white/5 px-2 py-1 text-xs text-neutral-200 hover:bg-white/10"
          title="Earlier 0.1s">−0.1s</button>
        <button type="button" onClick={() => onChange(0)}
          className="cursor-pointer rounded-md bg-white/5 px-2 py-1 text-xs text-neutral-400 hover:bg-white/10"
          disabled={offsetMs === 0} title="Reset">0</button>
        <button type="button" onClick={() => onChange(offsetMs + STEP)}
          className="cursor-pointer flex-1 rounded-md bg-white/5 px-2 py-1 text-xs text-neutral-200 hover:bg-white/10"
          title="Later 0.1s">+0.1s</button>
        <button type="button" onClick={() => onChange(offsetMs + BIG_STEP)}
          className="cursor-pointer flex-1 rounded-md bg-white/5 px-2 py-1 text-xs text-neutral-200 hover:bg-white/10"
          title="Later 0.5s">+0.5s</button>
      </div>
    </div>
  );
}

function StyleSlider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-300">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent"
      />
    </div>
  );
}
