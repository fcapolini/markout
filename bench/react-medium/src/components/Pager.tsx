import type { ReactNode } from 'react';

interface Props {
  current: number;
  count: number;
  prev: ReactNode;
  next: ReactNode;
}

export default function Pager({ current, count, prev, next }: Props) {
  return (
    <nav className="pager">
      {prev}
      <span className="pager-label">Page {current} of {count}</span>
      {next}
    </nav>
  );
}
