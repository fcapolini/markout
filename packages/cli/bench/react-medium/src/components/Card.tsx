import { memo } from 'react';
import Rating from './Rating';
import type { Item } from '../types';

interface Props {
  item: Item;
  inCart: boolean;
  onBuy: (item: Item) => void;
}

function Card({ item, inCart, onBuy }: Props) {
  return (
    <article className="card">
      <div className="card-media">
        <img src={item.image} alt={item.name} loading="lazy" />
        <span className="card-tag">{item.category}</span>
      </div>
      <div className="card-body">
        <p className="card-brand">{item.brand}</p>
        <h3 className="card-title">{item.name}</h3>
        <Rating score={item.rating} count={item.reviews} />
        <ul className="card-specs">
          {item.specs.map((s) => <li key={s}>{s}</li>)}
        </ul>
        <p className={'card-stock' + (item.stock < 8 ? ' card-stock-low' : '')}>
          {item.stock === 0 ? 'Back-ordered' : item.stock + ' in stock'}
        </p>
        <div className="card-foot">
          <span className="card-price">${item.price}</span>
          <button className="buy" disabled={inCart} onClick={() => onBuy(item)}>
            {inCart ? 'In cart' : 'Add'}
          </button>
        </div>
      </div>
    </article>
  );
}

// a competent React author would memoize a row this size in a list this
// large: same "avoid needless re-render" intent :for-each gets for free
export default memo(Card);
