interface Props {
  brand?: string;
  tagline: string;
  count: number;
  total: number;
  onReset: () => void;
}

export default function Header({ brand = 'Markout', tagline, count, total, onReset }: Props) {
  return (
    <header className="app-header">
      <div className="brand-block">
        <span className="brand">{brand}</span>
        <span className="tagline">{tagline}</span>
      </div>
      <div className="header-actions">
        <button className="ghost" onClick={onReset}>Reset view</button>
        <span className="header-cart">
          <strong>{count}</strong> in cart &middot; <strong>${total}</strong>
        </span>
      </div>
    </header>
  );
}
