<script setup vapor lang="ts">
import { computed, ref } from 'vue';
import { CATEGORIES, BRANDS, buildCatalog } from '../../shared/catalog.mjs';
import Header from './components/Header.vue';
import Section from './components/Section.vue';
import Stat from './components/Stat.vue';
import Facet from './components/Facet.vue';
import Search from './components/Search.vue';
import Card from './components/Card.vue';
import Pager from './components/Pager.vue';
import Cart from './components/Cart.vue';
import type { CartLineData, Item } from './types';

// ?rows=N picks the catalog size for perf testing (300/1,020/10,020 to match
// the other comparison targets); defaults to the 300-row demo.
const rowsParam = Number(new URLSearchParams(location.search).get('rows'));
const modelCount = rowsParam > 0 ? Math.round(rowsParam / 30) : 10;

// Module-level const, deliberately outside ref()/reactive(): the catalog never
// changes, and handing 10,020 items to a deep reactive proxy would be a cost
// the app never asks for. Every port keeps it out of its reactive system.
const CATALOG: Item[] = buildCatalog(modelCount);
const SIZE_OPTIONS = [12, 24, 48, CATALOG.length];
const SORT_OPTIONS = ['Featured', 'Price up', 'Price down', 'Rating', 'Name'];
const CATEGORY_OPTIONS = ['All', ...CATEGORIES];
const BRAND_OPTIONS = ['All', ...BRANDS];

const query = ref('');
const activeCategory = ref('All');
const activeBrand = ref('All');
const sort = ref('Featured');
const page = ref(1);
const pageSize = ref(24);
const cart = ref<CartLineData[]>([]);

const matches = computed(() =>
  CATALOG.filter(
    (item) =>
      (activeCategory.value === 'All' || item.category === activeCategory.value) &&
      (activeBrand.value === 'All' || item.brand === activeBrand.value) &&
      (query.value === '' ||
        (item.name + ' ' + item.brand).toLowerCase().includes(query.value.toLowerCase())),
  ),
);

const sorted = computed(() => {
  switch (sort.value) {
    case 'Price up': return [...matches.value].sort((a, b) => a.price - b.price);
    case 'Price down': return [...matches.value].sort((a, b) => b.price - a.price);
    case 'Rating': return [...matches.value].sort((a, b) => b.rating - a.rating);
    case 'Name': return [...matches.value].sort((a, b) => a.name.localeCompare(b.name));
    default: return matches.value;
  }
});

const pages = computed(() => Math.max(1, Math.ceil(sorted.value.length / pageSize.value)));
const shown = computed(() =>
  sorted.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);

const cartCount = computed(() => cart.value.reduce((t, l) => t + l.qty, 0));
const cartTotal = computed(() => cart.value.reduce((t, l) => t + l.price * l.qty, 0));
const inCartIds = computed(() => new Set(cart.value.map((l) => l.id)));
const averagePrice = computed(() =>
  matches.value.length === 0
    ? 0
    : Math.round(matches.value.reduce((t, i) => t + i.price, 0) / matches.value.length),
);
const lowStock = computed(() => matches.value.filter((i) => i.stock < 8).length);

function add(item: Item) {
  if (cart.value.some((l) => l.id === item.id)) return;
  cart.value = [...cart.value, { id: item.id, name: item.name, brand: item.brand, price: item.price, qty: 1 }];
}
function bump(id: string, step: number) {
  cart.value = cart.value.map((l) => (l.id === id ? { ...l, qty: l.qty + step } : l)).filter((l) => l.qty > 0);
}
function drop(id: string) {
  cart.value = cart.value.filter((l) => l.id !== id);
}
function clearCart() {
  cart.value = [];
}
function reset() {
  query.value = '';
  activeCategory.value = 'All';
  activeBrand.value = 'All';
  sort.value = 'Featured';
  page.value = 1;
}

function pickCategory(v: string) { activeCategory.value = v; page.value = 1; }
function pickBrand(v: string) { activeBrand.value = v; page.value = 1; }
function onSearch(v: string) { query.value = v; page.value = 1; }
function pickSize(v: number) { pageSize.value = v; page.value = 1; }
function pickSort(v: string) { sort.value = v; }
</script>

<template>
  <Header
    :tagline="`${CATALOG.length} items, one page, no framework`"
    :count="cartCount"
    :total="cartTotal"
    @reset="reset"
  />

  <main class="app-shell">
    <section class="board">
      <Stat label="Catalog" :value="CATALOG.length" hint="items generated at load" />
      <Stat label="Matching" :value="matches.length" hint="after filters" />
      <Stat label="Average price" :value="'$' + averagePrice" hint="across the current filter" />
      <Stat label="Low stock" :value="lowStock" hint="fewer than 8 left" />
    </section>

    <div class="layout">
      <Section kicker="Inventory" heading="Browse the catalog">
        <template #actions>
          <div class="sizes">
            <button
              v-for="size in SIZE_OPTIONS"
              :key="size"
              :class="'chip' + (size === pageSize ? ' chip-on' : '')"
              @click="pickSize(size)"
            >{{ size }}/page</button>
          </div>
        </template>

        <div class="filters">
          <Search :value="query" :hits="matches.length" @change="onSearch" />
          <Facet label="Category" :options="CATEGORY_OPTIONS" :active="activeCategory" @pick="pickCategory" />
          <Facet label="Brand" :options="BRAND_OPTIONS" :active="activeBrand" @pick="pickBrand" />
          <Facet label="Sort" :options="SORT_OPTIONS" :active="sort" @pick="pickSort" />
        </div>

        <div class="catalog-body">
          <p v-if="sorted.length === 0" class="empty">Nothing matches those filters.</p>
          <div class="grid">
            <Card
              v-for="item in shown"
              :key="item.id"
              :item="item"
              :in-cart="inCartIds.has(item.id)"
              @buy="add"
            />
          </div>
          <Pager :current="page" :count="pages">
            <template #prev>
              <button class="ghost" :disabled="page <= 1" @click="page -= 1">Previous</button>
            </template>
            <template #next>
              <button class="ghost" :disabled="page >= pages" @click="page += 1">Next</button>
            </template>
          </Pager>
        </div>
      </Section>

      <Cart
        :lines="cart"
        :total="cartTotal"
        @bump="bump"
        @drop="drop"
        @clear="clearCart"
      />
    </div>
  </main>
</template>
