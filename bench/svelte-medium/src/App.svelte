<script lang="ts">
  import { CATEGORIES, BRANDS, buildCatalog } from '../../shared/catalog.mjs';
  import Header from './components/Header.svelte';
  import Section from './components/Section.svelte';
  import Stat from './components/Stat.svelte';
  import Facet from './components/Facet.svelte';
  import Search from './components/Search.svelte';
  import Card from './components/Card.svelte';
  import Pager from './components/Pager.svelte';
  import Cart from './components/Cart.svelte';
  import type { CartLineData, Item } from './types';

  // ?rows=N picks the catalog size for perf testing (300/1,020/10,020 to
  // match the Markout/React comparison targets); defaults to the 300-row demo
  const rowsParam = Number(new URLSearchParams(location.search).get('rows'));
  const modelCount = rowsParam > 0 ? Math.round(rowsParam / 30) : 10;
  const CATALOG: Item[] = buildCatalog(modelCount);
  const SIZE_OPTIONS = [12, 24, 48, CATALOG.length];
  const SORT_OPTIONS = ['Featured', 'Price up', 'Price down', 'Rating', 'Name'];

  let query = $state('');
  let activeCategory = $state('All');
  let activeBrand = $state('All');
  let sort = $state('Featured');
  let page = $state(1);
  let pageSize = $state(24);
  let cart = $state<CartLineData[]>([]);

  let matches = $derived(
    CATALOG.filter(
      (item) =>
        (activeCategory === 'All' || item.category === activeCategory) &&
        (activeBrand === 'All' || item.brand === activeBrand) &&
        (query === '' || (item.name + ' ' + item.brand).toLowerCase().includes(query.toLowerCase())),
    ),
  );

  let sorted = $derived.by(() => {
    switch (sort) {
      case 'Price up': return [...matches].sort((a, b) => a.price - b.price);
      case 'Price down': return [...matches].sort((a, b) => b.price - a.price);
      case 'Rating': return [...matches].sort((a, b) => b.rating - a.rating);
      case 'Name': return [...matches].sort((a, b) => a.name.localeCompare(b.name));
      default: return matches;
    }
  });

  let pages = $derived(Math.max(1, Math.ceil(sorted.length / pageSize)));
  let shown = $derived(sorted.slice((page - 1) * pageSize, page * pageSize));

  let cartCount = $derived(cart.reduce((t, l) => t + l.qty, 0));
  let cartTotal = $derived(cart.reduce((t, l) => t + l.price * l.qty, 0));
  let inCartIds = $derived(new Set(cart.map((l) => l.id)));
  let averagePrice = $derived(
    matches.length === 0 ? 0 : Math.round(matches.reduce((t, i) => t + i.price, 0) / matches.length),
  );
  let lowStock = $derived(matches.filter((i) => i.stock < 8).length);

  function add(item: Item) {
    cart = cart.some((l) => l.id === item.id)
      ? cart
      : [...cart, { id: item.id, name: item.name, brand: item.brand, price: item.price, qty: 1 }];
  }
  function bump(id: string, step: number) {
    cart = cart.map((l) => (l.id === id ? { ...l, qty: l.qty + step } : l)).filter((l) => l.qty > 0);
  }
  function drop(id: string) {
    cart = cart.filter((l) => l.id !== id);
  }
  function clearCart() {
    cart = [];
  }
  function reset() {
    query = '';
    activeCategory = 'All';
    activeBrand = 'All';
    sort = 'Featured';
    page = 1;
  }

  function pickCategory(v: string) { activeCategory = v; page = 1; }
  function pickBrand(v: string) { activeBrand = v; page = 1; }
  function onSearch(v: string) { query = v; page = 1; }
  function pickSize(v: number) { pageSize = v; page = 1; }
  function pickSort(v: string) { sort = v; }
</script>

<Header tagline={`${CATALOG.length} items, one page, no framework`} count={cartCount} total={cartTotal} onReset={reset} />

<main class="app-shell">
  <section class="board">
    <Stat label="Catalog" value={CATALOG.length} hint="items generated at load" />
    <Stat label="Matching" value={matches.length} hint="after filters" />
    <Stat label="Average price" value={'$' + averagePrice} hint="across the current filter" />
    <Stat label="Low stock" value={lowStock} hint="fewer than 8 left" />
  </section>

  <div class="layout">
    <Section kicker="Inventory" heading="Browse the catalog">
      {#snippet actions()}
        <div class="sizes">
          {#each SIZE_OPTIONS as size (size)}
            <button class={'chip' + (size === pageSize ? ' chip-on' : '')} onclick={() => pickSize(size)}>
              {size}/page
            </button>
          {/each}
        </div>
      {/snippet}

      <div class="filters">
        <Search value={query} hits={matches.length} onChange={onSearch} />
        <Facet label="Category" options={['All', ...CATEGORIES]} active={activeCategory} onPick={pickCategory} />
        <Facet label="Brand" options={['All', ...BRANDS]} active={activeBrand} onPick={pickBrand} />
        <Facet label="Sort" options={SORT_OPTIONS} active={sort} onPick={pickSort} />
      </div>

      <div class="catalog-body">
        {#if sorted.length === 0}
          <p class="empty">Nothing matches those filters.</p>
        {/if}
        <div class="grid">
          {#each shown as item (item.id)}
            <Card {item} inCart={inCartIds.has(item.id)} onBuy={add} />
          {/each}
        </div>
        <Pager current={page} count={pages}>
          {#snippet prev()}
            <button class="ghost" disabled={page <= 1} onclick={() => (page -= 1)}>Previous</button>
          {/snippet}
          {#snippet next()}
            <button class="ghost" disabled={page >= pages} onclick={() => (page += 1)}>Next</button>
          {/snippet}
        </Pager>
      </div>
    </Section>

    <Cart lines={cart} total={cartTotal} onBump={bump} onDrop={drop} onClear={clearCart} />
  </div>
</main>
