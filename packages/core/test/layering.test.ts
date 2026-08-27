import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * No import in `src/` points upward through core's layering, and nothing in
 * core reaches outside the package.
 *
 * The layers below are what `@markout-lang/core` is made of -- see
 * docs/design/monorepo.md. They were asserted before the package existed,
 * while everything was still one package and nothing enforced them, and they
 * are still asserted now for the reason they were then: a cycle inside core
 * is free to write and invisible until something has to be extracted from
 * it, and the language server that will read pages without serving them is
 * that something.
 *
 * The point is the DIRECTION, not the file list. When a file moves, move its
 * entry; when a new one is added, name its layer. Being made to answer
 * "which layer is this in?" while writing it is the whole value of the test.
 */

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** lowest first: a layer may import from itself and anything above it here */
const LAYERS: { name: string; members: string[] }[] = [
  // `manifest.ts` is base and not a layer of its own: it is fs and path and
  // nothing else, and discovery imports it in order to report a kit the
  // project asked for and has not got
  { name: 'base', members: ['kits.ts', 'manifest.ts', 'paths.ts'] },
  { name: 'html', members: ['html/'] },
  // what a docroot may serve, which is a question about paths answered by
  // reading files -- so it sits above html rather than beside paths
  { name: 'publish', members: ['publish.ts'] },
  { name: 'runtime', members: ['runtime/'] },
  { name: 'compiler', members: ['compiler/'] },
  // server-side rendering, and the browser bundle a rendered page asks for.
  // Needed with no HTTP anywhere, which is why it is in core at all
  { name: 'render', members: ['render/'] },
  // the ahead-of-time build: a compile and a render written to disk, which is
  // why it sits above both and below the barrel
  { name: 'build', members: ['build.ts'] },
  // the package boundary itself: the only file allowed to see everything
  { name: 'index', members: ['index.ts'] },
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

/**
 * Every relative import target in a file, as a path relative to src/.
 *
 * Extension-less by design: which of `x.ts` and `x/index.ts` the target is
 * doesn't matter here, because both spellings land in the same layer -- a
 * layer is a directory or a named file, and `x/index.ts` is inside `x/`.
 */
function importsOf(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const from = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  const bare = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  const dir = path.dirname(file);
  return [...text.matchAll(from), ...text.matchAll(bare)]
    .map(m => m[1])
    .filter(spec => spec.startsWith('.'))
    .map(spec => path.relative(SRC, path.resolve(dir, spec)));
}

describe('core layering', () => {
  const files = sourceFiles(SRC).map(f => path.relative(SRC, f));

  it('finds the sources', () => {
    // the walk returning nothing would make everything below vacuous
    expect(files.length).toBeGreaterThan(20);
  });

  it('assigns every file to exactly one layer', () => {
    const unclaimed = files.filter(f => layersOf(f).length === 0);
    expect(unclaimed, 'name the layer of each in LAYERS above').toEqual([]);

    const ambiguous = files.filter(f => layersOf(f).length > 1);
    expect(ambiguous, 'claimed by two layers').toEqual([]);
  });

  for (const file of files) {
    it(`${file} imports downward only`, () => {
      const here = layerOf(file);
      const targets = importsOf(path.join(SRC, file));

      // A relative import that leaves the package is the one failure this
      // file cannot express as a layer, and the most serious: core is what
      // an editor process will load, and reaching sideways into the CLI or
      // the middleware is how express ends up in it.
      const escaping = targets.filter(t => t.startsWith('..'));
      expect(escaping, 'reaches outside @markout-lang/core').toEqual([]);

      // an import nothing claims means the member lists went stale, and a
      // stale list is indistinguishable from a clean result. So it fails
      // here rather than passing quietly
      const unknown = targets.filter(t => layerOf(t) < 0);
      expect(unknown, 'not in any layer -- LAYERS is out of date').toEqual([]);

      const up = targets
        .map(target => ({ target, layer: layerOf(target) }))
        .filter(t => t.layer > here)
        .map(t => `${t.target} (${LAYERS[t.layer].name})`);

      expect(
        up,
        `core/${LAYERS[here]?.name} cannot depend on these`
      ).toEqual([]);
    });
  }
});
