import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The middleware's own layering, and the boundary between it and
 * `@markout-dev/core`.
 *
 * The layers are small and the direction still matters: the pieces the
 * middleware drives -- the logger it reports through, the watcher it asks
 * about changes, the reloader it injects -- must not know about the
 * middleware itself, or the package has a cycle in four files.
 *
 * The boundary check is that core is reached BY ITS PACKAGE NAME and never
 * by a relative path. A workspace makes `../core/src/compiler` resolve
 * perfectly well from here, so nothing but this test stands between the
 * curated surface in core's index.ts and a dependency on one of its
 * internals. See docs/design/monorepo.md.
 */

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** lowest first: a layer may import from itself and anything above it here */
const LAYERS: { name: string; pkg: string; members: string[] }[] = [
  {
    name: 'parts',
    pkg: '@markout-dev/express',
    members: ['livereload.ts', 'logger.ts', 'watcher.ts'],
  },
  {
    name: 'middleware',
    pkg: '@markout-dev/express',
    members: ['middleware.ts'],
  },
  // the package boundary itself: the only file allowed to see everything
  {
    name: 'index',
    pkg: '@markout-dev/express',
    members: ['index.ts'],
  },
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

/** every layer claiming a path relative to src/ -- normally one, never two */
function layersOf(rel: string): number[] {
  // an import writes `./render`, the member list writes `server/render.ts`,
  // and a directory may be reached as `x` or `x/index`. All three spellings
  // are the same file, and getting this wrong is how the test goes vacuous
  const spellings = [rel, `${rel}.ts`, `${rel}/index.ts`];
  const claims: number[] = [];
  LAYERS.forEach((l, i) => {
    const hit = l.members.some(m =>
      m.endsWith('/') ? spellings.some(s => s.startsWith(m)) : spellings.includes(m)
    );
    if (hit) claims.push(i);
  });
  return claims;
}

/** the layer index of a path relative to src/, or -1 if nothing claims it */
function layerOf(rel: string): number {
  return layersOf(rel)[0] ?? -1;
}

/** every import specifier in a file, relative ones resolved against src/ */
function importsOf(file: string): { spec: string; rel: string | null }[] {
  const text = fs.readFileSync(file, 'utf8');
  const from = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  const bare = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  const dir = path.dirname(file);
  return [...text.matchAll(from), ...text.matchAll(bare)].map(m => ({
    spec: m[1],
    rel: m[1].startsWith('.')
      ? path.relative(SRC, path.resolve(dir, m[1]))
      : null,
  }));
}

describe('express layering', () => {
  const files = sourceFiles(SRC).map(f => path.relative(SRC, f));

  it('finds the sources', () => {
    // the walk returning nothing would make everything below vacuous
    expect(files.length).toBeGreaterThan(3);
  });

  it('assigns every file to exactly one layer', () => {
    const unclaimed = files.filter(f => layersOf(f).length === 0);
    expect(unclaimed, 'name the layer of each in LAYERS above').toEqual([]);

    const ambiguous = files.filter(f => layersOf(f).length > 1);
    expect(ambiguous, 'claimed by two layers').toEqual([]);
  });

  for (const file of files) {
    it(`${file} respects the boundary`, () => {
      const here = layerOf(file);
      const imports = importsOf(path.join(SRC, file));

      // core is a package, not a directory next door
      const reachingIn = imports
        .filter(i => i.rel !== null && i.rel.startsWith('..'))
        .map(i => i.spec);
      expect(
        reachingIn,
        'import from "@markout-dev/core" instead -- see its index.ts'
      ).toEqual([]);

      const targets = imports.map(i => i.rel).filter((r): r is string => r !== null);

      // an import nothing claims means the member lists went stale, and a
      // stale list is indistinguishable from a clean result. So it fails
      // here rather than passing quietly
      const unknown = targets.filter(t => layerOf(t) < 0);
      expect(unknown, 'not in any layer -- LAYERS is out of date').toEqual([]);

      const up = targets
        .map(target => ({ target, layer: layerOf(target) }))
        .filter(t => t.layer > here)
        .map(t => `${t.target} (${LAYERS[t.layer].pkg})`);

      expect(up, `${LAYERS[here]?.pkg} cannot depend on these`).toEqual([]);
    });
  }
});
