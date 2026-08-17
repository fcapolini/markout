<script lang="ts">
  let { brand = 'Markout', tagline, count, total, onReset }: {
    brand?: string;
    tagline: string;
    count: number;
    total: number;
    onReset: () => void;
  } = $props();
</script>

<header class="app-header">
  <div class="brand-block">
    <span class="brand">{brand}</span>
    <span class="tagline">{tagline}</span>
  </div>
  <div class="header-actions">
    <button class="ghost" onclick={onReset}>Reset view</button>
    <span class="header-cart"><strong>{count}</strong> in cart &middot; <strong>${total}</strong></span>
  </div>
</header>
