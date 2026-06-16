interface GenrePillProps {
  name: string;
}

export function GenrePill({ name }: GenrePillProps) {
  return (
    <span className="rounded-full border border-accent-light/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent-light">
      {name}
    </span>
  );
}
