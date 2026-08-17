import type { ReactNode } from 'react';

interface Props {
  kicker: string;
  heading: string;
  actions?: ReactNode;
  children: ReactNode;
}

export default function Section({ kicker, heading, actions, children }: Props) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <p className="kicker">{kicker}</p>
          <h2>{heading}</h2>
        </div>
        <div className="panel-actions">{actions}</div>
      </header>
      {children}
    </section>
  );
}
