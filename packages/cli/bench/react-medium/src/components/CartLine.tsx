import { memo } from 'react';
import type { CartLineData } from '../types';

interface Props {
  line: CartLineData;
  onBump: (id: string, step: number) => void;
  onDrop: (id: string) => void;
}

function CartLine({ line, onBump, onDrop }: Props) {
  return (
    <li className="cart-line">
      <div className="cart-line-main">
        <span className="cart-line-name">{line.name}</span>
        <span className="cart-line-meta">{line.brand} &middot; ${line.price} each</span>
      </div>
      <div className="cart-line-qty">
        <button className="ghost" onClick={() => onBump(line.id, -1)} aria-label={'One fewer ' + line.name}>&minus;</button>
        <span className="qty">{line.qty}</span>
        <button className="ghost" onClick={() => onBump(line.id, 1)} aria-label={'One more ' + line.name}>+</button>
        <button className="ghost drop" onClick={() => onDrop(line.id)} aria-label={'Remove ' + line.name}>&times;</button>
      </div>
      <span className="cart-line-total">${line.price * line.qty}</span>
    </li>
  );
}

export default memo(CartLine);
