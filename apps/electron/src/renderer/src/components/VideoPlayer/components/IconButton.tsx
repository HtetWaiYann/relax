import { type ReactNode } from 'react';

export function IconButton({
  children,
  onClick,
  'aria-label': aria,
}: {
  children: ReactNode;
  onClick: () => void;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      className="cursor-pointer rounded-md p-2 text-neutral-200 transition hover:bg-white/10"
    >
      {children}
    </button>
  );
}
