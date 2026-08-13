// Single source of truth for the "medium" catalog benchmark's seed data and
// item-generation formula, shared by the Markout demo's bench-page generator
// and the React/Svelte comparison apps -- so all three benchmark the exact
// same dataset shape at the exact same row count, not three approximations
// of it. Plain zero-dependency JS so it's importable from a bare `node`
// script (Markout side) and from a Vite build (React/Svelte side) alike.

export const CATEGORIES = ['Audio', 'Lighting', 'Desk', 'Outdoor', 'Kitchen', 'Studio'];
export const BRANDS = ['Northwind', 'Bellhaven', 'Kestrel', 'Marlowe', 'Orrery', 'Tundra'];
export const FINISHES = ['Ash', 'Brass', 'Cobalt', 'Slate', 'Terracotta'];
export const IMAGES = [
  'https://images.unsplash.com/photo-1567375698348-5d9d5ae99de0?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1504545102780-26774c1bb073?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1652803072914-9f6119191238?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1692561796478-3c43d6656e42?auto=format&fit=crop&w=900&q=80',
];

/** `modelCount` models named the same way regardless of size: Model0001, Model0002, ... */
export function makeModels(modelCount) {
  return Array.from({ length: modelCount }, (_, i) => `Model${String(i + 1).padStart(4, '0')}`);
}

/**
 * categories.length x models.length x finishes.length items, using the same
 * id/price/rating/reviews/stock/specs formulas as demo/medium/index.html.
 * The id's category spacing is `models.length * finishes.length` -- NOT a
 * hardcoded 50 -- so ids stay collision-free (and :for-key-equivalent
 * lookups stay correct) at any model count. See markout-authoring memory:
 * the original demo/medium bench pages hit this exact bug when scaled.
 */
export function buildCatalog(modelCount) {
  const models = makeModels(modelCount);
  const spacing = modelCount * FINISHES.length;
  return CATEGORIES.flatMap((category, c) =>
    models.flatMap((model, m) =>
      FINISHES.map((finish, f) => {
        const n = c * spacing + m * FINISHES.length + f;
        return {
          id: 'p' + n,
          name: model + ' ' + finish,
          category,
          brand: BRANDS[(m + f) % BRANDS.length],
          price: 18 + (n * 7) % 180,
          rating: 3 + ((n * 3) % 20) / 10,
          reviews: 12 + (n * 13) % 400,
          stock: (n * 5) % 40,
          image: IMAGES[n % IMAGES.length],
          specs: ['Finish: ' + finish, 'Ships in ' + (1 + n % 5) + ' days', 'Warranty ' + (1 + n % 3) + ' yr'],
        };
      })
    )
  );
}
