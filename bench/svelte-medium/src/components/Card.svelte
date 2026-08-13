<script lang="ts">
  import Rating from './Rating.svelte';
  import type { Item } from '../types';

  let { item, inCart, onBuy }: { item: Item; inCart: boolean; onBuy: (item: Item) => void } = $props();
</script>

<article class="card">
  <div class="card-media">
    <img src={item.image} alt={item.name} loading="lazy" />
    <span class="card-tag">{item.category}</span>
  </div>
  <div class="card-body">
    <p class="card-brand">{item.brand}</p>
    <h3 class="card-title">{item.name}</h3>
    <Rating score={item.rating} count={item.reviews} />
    <ul class="card-specs">
      {#each item.specs as s (s)}<li>{s}</li>{/each}
    </ul>
    <p class={'card-stock' + (item.stock < 8 ? ' card-stock-low' : '')}>
      {item.stock === 0 ? 'Back-ordered' : item.stock + ' in stock'}
    </p>
    <div class="card-foot">
      <span class="card-price">${item.price}</span>
      <button class="buy" disabled={inCart} onclick={() => onBuy(item)}>{inCart ? 'In cart' : 'Add'}</button>
    </div>
  </div>
</article>
