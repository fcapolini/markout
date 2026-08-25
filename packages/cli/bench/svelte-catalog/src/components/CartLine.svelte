<script lang="ts">
  import type { CartLineData } from '../types';
  let { line, onBump, onDrop }: {
    line: CartLineData;
    onBump: (id: string, step: number) => void;
    onDrop: (id: string) => void;
  } = $props();
</script>

<li class="cart-line">
  <div class="cart-line-main">
    <span class="cart-line-name">{line.name}</span>
    <span class="cart-line-meta">{line.brand} &middot; ${line.price} each</span>
  </div>
  <div class="cart-line-qty">
    <button class="ghost" onclick={() => onBump(line.id, -1)} aria-label={'One fewer ' + line.name}>&minus;</button>
    <span class="qty">{line.qty}</span>
    <button class="ghost" onclick={() => onBump(line.id, 1)} aria-label={'One more ' + line.name}>+</button>
    <button class="ghost drop" onclick={() => onDrop(line.id)} aria-label={'Remove ' + line.name}>&times;</button>
  </div>
  <span class="cart-line-total">${line.price * line.qty}</span>
</li>
