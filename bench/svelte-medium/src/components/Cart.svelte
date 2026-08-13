<script lang="ts">
  import CartLineRow from './CartLine.svelte';
  import type { CartLineData } from '../types';
  let { lines, total, onBump, onDrop, onClear }: {
    lines: CartLineData[];
    total: number;
    onBump: (id: string, step: number) => void;
    onDrop: (id: string) => void;
    onClear: () => void;
  } = $props();
</script>

<aside class="cart">
  <header class="cart-head">
    <h2>Cart</h2>
    <button class="ghost" disabled={lines.length === 0} onclick={onClear}>Clear</button>
  </header>
  {#if lines.length === 0}
    <p class="cart-empty">Nothing yet &mdash; add something from the catalog.</p>
  {/if}
  <ul class="cart-lines">
    {#each lines as line (line.id)}
      <CartLineRow {line} {onBump} {onDrop} />
    {/each}
  </ul>
  <footer class="cart-foot">
    <span>Total</span>
    <strong>${total}</strong>
  </footer>
</aside>
