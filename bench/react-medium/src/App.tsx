import { useCallback, useMemo, useState } from 'react';
import { CATEGORIES, BRANDS, buildCatalog } from '../../shared/catalog.mjs';
import Header from './components/Header';
import Section from './components/Section';
import Stat from './components/Stat';
import Facet from './components/Facet';
import Search from './components/Search';
import Card from './components/Card';
import Pager from './components/Pager';
import Cart from './components/Cart';
import type { CartLineData, Item } from './types';

// ?rows=N picks the catalog size for perf testing (300/1,020/10,020 to match
// the Markout/Svelte comparison targets); defaults to the 300-row demo shape
const rowsParam = Number(new URLSearchParams(location.search).get('rows'));
const modelCount = rowsParam > 0 ? Math.round(rowsParam / 30) : 10;
const CATALOG: Item[] = buildCatalog(modelCount);
const SIZE_OPTIONS = [12, 24, 48, CATALOG.length];
const SORT_OPTIONS = ['Featured', 'Price up', 'Price down', 'Rating', 'Name'];

export default function App() {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeBrand, setActiveBrand] = useState('All');
  const [sort, setSort] = useState('Featured');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [cart, setCart] = useState<CartLineData[]>([]);

  const matches = useMemo(
    () =>
      CATALOG.filter(
        (item) =>
          (activeCategory === 'All' || item.category === activeCategory) &&
          (activeBrand === 'All' || item.brand === activeBrand) &&
          (query === '' || (item.name + ' ' + item.brand).toLowerCase().includes(query.toLowerCase())),
      ),
    [activeCategory, activeBrand, query],
  );

  const sorted = useMemo(() => {
    switch (sort) {
      case 'Price up': return [...matches].sort((a, b) => a.price - b.price);
      case 'Price down': return [...matches].sort((a, b) => b.price - a.price);
      case 'Rating': return [...matches].sort((a, b) => b.rating - a.rating);
      case 'Name': return [...matches].sort((a, b) => a.name.localeCompare(b.name));
      default: return matches;
    }
  }, [matches, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const shown = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  const cartCount = cart.reduce((total, line) => total + line.qty, 0);
  const cartTotal = cart.reduce((total, line) => total + line.price * line.qty, 0);

  const add = useCallback((item: Item) => {
    setCart((prev) =>
      prev.some((line) => line.id === item.id)
        ? prev
        : [...prev, { id: item.id, name: item.name, brand: item.brand, price: item.price, qty: 1 }],
    );
  }, []);
  const bump = useCallback((id: string, step: number) => {
    setCart((prev) =>
      prev
        .map((line) => (line.id === id ? { ...line, qty: line.qty + step } : line))
        .filter((line) => line.qty > 0),
    );
  }, []);
  const drop = useCallback((id: string) => setCart((prev) => prev.filter((line) => line.id !== id)), []);
  const clearCart = useCallback(() => setCart([]), []);
  const reset = useCallback(() => {
    setQuery('');
    setActiveCategory('All');
    setActiveBrand('All');
    setSort('Featured');
    setPage(1);
  }, []);

  const inCartIds = useMemo(() => new Set(cart.map((line) => line.id)), [cart]);
  const averagePrice =
    matches.length === 0 ? 0 : Math.round(matches.reduce((t, i) => t + i.price, 0) / matches.length);
  const lowStock = matches.filter((item) => item.stock < 8).length;

  return (
    <>
      <Header
        tagline={`${CATALOG.length} items, one page, no framework`}
        count={cartCount}
        total={cartTotal}
        onReset={reset}
      />
      <main className="app-shell">
        <section className="board">
          <Stat label="Catalog" value={CATALOG.length} hint="items generated at load" />
          <Stat label="Matching" value={matches.length} hint="after filters" />
          <Stat label="Average price" value={'$' + averagePrice} hint="across the current filter" />
          <Stat label="Low stock" value={lowStock} hint="fewer than 8 left" />
        </section>

        <div className="layout">
          <Section
            kicker="Inventory"
            heading="Browse the catalog"
            actions={
              <div className="sizes">
                {SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    className={'chip' + (size === pageSize ? ' chip-on' : '')}
                    onClick={() => { setPageSize(size); setPage(1); }}
                  >
                    {size}/page
                  </button>
                ))}
              </div>
            }
          >
            <div className="filters">
              <Search value={query} hits={matches.length} onChange={(v) => { setQuery(v); setPage(1); }} />
              <Facet
                label="Category"
                options={['All', ...CATEGORIES]}
                active={activeCategory}
                onPick={(v) => { setActiveCategory(v); setPage(1); }}
              />
              <Facet
                label="Brand"
                options={['All', ...BRANDS]}
                active={activeBrand}
                onPick={(v) => { setActiveBrand(v); setPage(1); }}
              />
              <Facet label="Sort" options={SORT_OPTIONS} active={sort} onPick={setSort} />
            </div>

            <div className="catalog-body">
              {sorted.length === 0 && <p className="empty">Nothing matches those filters.</p>}
              <div className="grid">
                {shown.map((item) => (
                  <Card key={item.id} item={item} inCart={inCartIds.has(item.id)} onBuy={add} />
                ))}
              </div>
              <Pager
                current={page}
                count={pages}
                prev={
                  <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                }
                next={
                  <button className="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
                }
              />
            </div>
          </Section>

          <Cart lines={cart} total={cartTotal} onBump={bump} onDrop={drop} onClear={clearCart} />
        </div>
      </main>
    </>
  );
}
