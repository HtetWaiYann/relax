import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface DropdownOption<T> {
  value: T;
  label: string;
}

interface DropdownProps<T> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  // Shown on the trigger when no option matches value (e.g. genre id 0 = "All"
  // when the caller doesn't include an option for it).
  placeholder?: string;
  className?: string;
}

// Custom listbox replacing native <select> so the popup matches app styling.
// ponytail: options are real <button>s (tab-focusable, Enter/Space work); no
// roving-tabindex arrow nav — add if a11y review asks for it.
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = 'Select',
  className = '',
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface-muted/60 px-3 py-2 text-sm text-neutral-100 transition hover:border-accent-light/40 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border-subtle bg-surface-elevated py-1 shadow-lg shadow-black/40"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={String(o.value)} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                    active
                      ? 'bg-accent/15 text-accent-light'
                      : 'text-neutral-300 hover:bg-surface-muted/60 hover:text-neutral-100'
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {active && <Check className="h-4 w-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
