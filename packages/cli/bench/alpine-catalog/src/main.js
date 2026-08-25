import Alpine from 'alpinejs';
import { CATEGORIES, BRANDS, buildCatalog } from '../../shared/catalog.mjs';

// ?rows=N picks the catalog size for perf testing (300/1,020/10,020 to match
// the Markout/React/Svelte comparison targets); defaults to the 300-row demo.
const rowsParam = Number(new URLSearchParams(location.search).get('rows'));
const modelCount = rowsParam > 0 ? Math.round(rowsParam / 30) : 10;

// Deliberately outside the reactive data object, exactly as the Svelte port
// keeps it out of $state: the catalog is a constant, and handing 10,020 items
// to a deep reactive proxy would be a cost the app never asks for.
const CATALOG = buildCatalog(modelCount);

Alpine.data('catalog', () => ({
  catalogLength: CATALOG.length,
  sizeOptions: [12, 24, 48, CATALOG.length],
  sortOptions: ['Featured', 'Price up', 'Price down', 'Rating', 'Name'],
  categoryOptions: ['All', ...CATEGORIES],
  brandOptions: ['All', ...BRANDS],

  query: '',
  activeCategory: 'All',
  activeBrand: 'All',
  sort: 'Featured',
  page: 1,
  pageSize: 24,
  cart: [],

  // The filtered-and-sorted list is plain state recomputed by refresh(), not a
  // getter. Alpine has no memoized derived value -- React has useMemo, Svelte
  // has $derived, Markout caches a `:name=` -- and a getter re-runs on every
  // read, so the six bindings that want this list would each re-filter the
  // whole catalog. Recomputing once per state change is what an Alpine app at
  // this size has to do, and it is what is measured here.
  sorted: [],

  // Membership as a mutated Set for the same reason: every card asks whether
  // it is in the cart, and a getter rebuilding the Set would rebuild it once
  // per card. Alpine's reactivity tracks Set.has, so mutating in place is both
  // correct and the cheap way to write it.
  cartIds: new Set(),

  init() {
    this.refresh();
  },

  refresh() {
    const q = this.query.toLowerCase();
    const category = this.activeCategory;
    const brand = this.activeBrand;
    const matches = CATALOG.filter(
      (item) =>
        (category === 'All' || item.category === category) &&
        (brand === 'All' || item.brand === brand) &&
        (q === '' || (item.name + ' ' + item.brand).toLowerCase().includes(q)),
    );
    switch (this.sort) {
      case 'Price up': matches.sort((a, b) => a.price - b.price); break;
      case 'Price down': matches.sort((a, b) => b.price - a.price); break;
      case 'Rating': matches.sort((a, b) => b.rating - a.rating); break;
      case 'Name': matches.sort((a, b) => a.name.localeCompare(b.name)); break;
      default: break; // 'Featured' is the catalog's own order, which filter keeps
    }
    this.sorted = matches;
  },

  get pages() {
    return Math.max(1, Math.ceil(this.sorted.length / this.pageSize));
  },
  get shown() {
    return this.sorted.slice((this.page - 1) * this.pageSize, this.page * this.pageSize);
  },
  get cartCount() {
    return this.cart.reduce((total, line) => total + line.qty, 0);
  },
  get cartTotal() {
    return this.cart.reduce((total, line) => total + line.price * line.qty, 0);
  },
  get averagePrice() {
    const list = this.sorted;
    return list.length === 0 ? 0 : Math.round(list.reduce((t, i) => t + i.price, 0) / list.length);
  },
  get lowStock() {
    return this.sorted.filter((item) => item.stock < 8).length;
  },

  inCart(id) {
    return this.cartIds.has(id);
  },

  add(item) {
    if (this.cartIds.has(item.id)) return;
    this.cartIds.add(item.id);
    this.cart.push({ id: item.id, name: item.name, brand: item.brand, price: item.price, qty: 1 });
  },
  bump(id, step) {
    const line = this.cart.find((l) => l.id === id);
    if (!line) return;
    line.qty += step;
    if (line.qty <= 0) this.drop(id);
  },
  drop(id) {
    this.cartIds.delete(id);
    this.cart = this.cart.filter((line) => line.id !== id);
  },
  clearCart() {
    this.cartIds.clear();
    this.cart = [];
  },

  reset() {
    this.query = '';
    this.activeCategory = 'All';
    this.activeBrand = 'All';
    this.sort = 'Featured';
    this.page = 1;
    this.refresh();
  },

  pickCategory(value) { this.activeCategory = value; this.page = 1; this.refresh(); },
  pickBrand(value) { this.activeBrand = value; this.page = 1; this.refresh(); },
  pickSort(value) { this.sort = value; this.refresh(); },
  pickSize(value) { this.pageSize = value; this.page = 1; },
  onSearch(value) { this.query = value; this.page = 1; this.refresh(); },
}));

window.Alpine = Alpine;
Alpine.start();
