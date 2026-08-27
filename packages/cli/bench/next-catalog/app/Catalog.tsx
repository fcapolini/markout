'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

const SORT_OPTIONS = ['Featured', 'Price up', 'Price down', 'Rating', 'Name'];

/**
 * The client boundary, and the whole port's one real judgment call.
 *
 * The four SPA ports build the entire catalog in the browser and do every
 * filter, sort and page there. This port has to render the first page on the
 * SERVER -- that is what it is here to measure -- and then be the same app in
 * the browser afterwards, which means the browser needs the whole catalog too.
 * There are two ways to get it there and they measure different things:
 *
 *   1. Serialize it across the RSC boundary: `<Catalog items={catalog} />`.
 *      Ten thousand objects then travel in the flight payload, inline in the
 *      document, and the weight column grows by megabytes.
 *   2. Pass the seed and rebuild: `<Catalog modelCount={n} />`, below. The
 *      payload stays a single number and the browser does the same
 *      `buildCatalog` work every other port does.
 *
 * This port does (2), on purpose, and it is worth being clear that (2) is the
 * FAVOURABLE choice for Next. (1) is what a large number of real App Router
 * codebases contain, and it would produce a far worse weight number. Picking
 * the flattering configuration for the port Markout is being read against is
 * the same discipline that keeps `markout prerender` out of the comparison:
 * the interesting result is the one where the other tool is at its best.
 *
 * What it does not let Next escape is the double build. `buildCatalog` runs
 * once on the server to render the first page and once again in the browser to
 * hydrate it, because a hydrating component has to be able to reproduce what
 * the server sent. That second run is not a flaw in the port; it is the
 * hydration model, and it belongs in the numbers.
 */
export default function Catalog({ modelCount }: { modelCount: number }) {
  const CATALOG = useMemo<Item[]>(() => buildCatalog(modelCount), [modelCount]);
  const SIZE_OPTIONS = useMemo(() => [12, 24, 48, CATALOG.length], [CATALOG.length]);

  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeBrand, setActiveBrand] = useState('All');
  const [sort, setSort] = useState('Featured');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [cart, setCart] = useState<CartLineData[]>([]);

  // THE MEASUREMENT HANDSHAKE. See PORT-NOTES.md -- this one line is load-
  // bearing for every number the harness reports about this port.
  //
  // A server-rendered page has its buttons in the markup before React has
  // attached a single listener to them, which the four SPA ports never do:
  // there, nothing exists until the bundle has run, so "the element is there"
  // and "the element works" are the same instant. Here they are not, and a
  // harness that clicks as soon as it sees `button.chip` clicks dead markup.
  //
  // An effect in the ROOT client component is the latest honest signal
  // available: React commits the whole hydrated subtree before it runs
  // effects, so by the time this fires every handler below it is live.
  useEffect(() => {
    (window as Window & { __ready?: number }).__ready = performance.now();
  }, []);

  const matches = useMemo(
    () =>
      CATALOG.filter(
        (item) =>
          (activeCategory === 'All' || item.category === activeCategory) &&
          (activeBrand === 'All' || item.brand === activeBrand) &&
          (query === '' || (item.name + ' ' + item.brand).toLowerCase().includes(query.toLowerCase())),
      ),
    [CATALOG, activeCategory, activeBrand, query],
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
