import CartLineRow from './CartLine';
import type { CartLineData } from '../types';

interface Props {
  lines: CartLineData[];
  total: number;
  onBump: (id: string, step: number) => void;
  onDrop: (id: string) => void;
  onClear: () => void;
}

export default function Cart({ lines, total, onBump, onDrop, onClear }: Props) {
  return (
    <aside className="cart">
      <header className="cart-head">
        <h2>Cart</h2>
        <button className="ghost" disabled={lines.length === 0} onClick={onClear}>Clear</button>
      </header>
      {lines.length === 0 && <p className="cart-empty">Nothing yet &mdash; add something from the catalog.</p>}
      <ul className="cart-lines">
        {lines.map((line) => (
          <CartLineRow key={line.id} line={line} onBump={onBump} onDrop={onDrop} />
        ))}
      </ul>
      <footer className="cart-foot">
        <span>Total</span>
        <strong>${total}</strong>
      </footer>
    </aside>
  );
}
