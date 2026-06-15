import type { ReactNode } from 'react';

interface HorizontalRowProps {
  label: string;
  children: ReactNode;
}

export function HorizontalRow({ label, children }: HorizontalRowProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-100">{label}</h2>
      <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2 snap-x">
        {children}
      </div>
    </section>
  );
}
