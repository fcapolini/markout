import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * No import in `src/` points upward through the layering, and no two layers
 * depend on each other.
 *
 * The layers below are the packages this repository is being split into --
 * see docs/design/monorepo.md. They are asserted here, while everything is
 * still ONE package and nothing enforces them, because that is the window in
 * which a violation is free to write and invisible: a `require` from the
 * compiler into the middleware works perfectly today and makes the extension
 * impossible tomorrow.
 *
 * The point is the DIRECTION, not the file list. When a file moves, move its
 * entry; when a new one is added, name its layer. Being made to answer "which
 * package is this in?" while writing it is the whole value of the test.
 */

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** lowest first: a layer may import from itself and anything above it here */
const LAYERS: { name: string; pkg: string; members: string[] }[] = [
  { name: 'base', pkg: '@markout/core', members: ['kits.ts', 'paths.ts'] },
  { name: 'html', pkg: '@markout/core', members: ['html/'] },
  { name: 'runtime', pkg: '@markout/core', members: ['runtime/'] },
  { name: 'compiler', pkg: '@markout/core', members: ['compiler/'] },
  {
    // server-side rendering and the rules about what a kit may serve: needed
    // with no HTTP anywhere, by `markout build`
    name: 'render',
    pkg: '@markout/core',
    members: [
      'server/publish.ts',
      'server/render.ts',
      'server/runtime-bundle.ts',
      'server/serialize.ts',
    ],
  },
  {
    name: 'http',
    pkg: '@markout/express',
    members: [
      'server/livereload.ts',
      'server/logger.ts',
      'server/middleware.ts',
      'server/watcher.ts',
    ],
  },
  {
    name: 'cli',
    pkg: 'markout',
    members: [
      'cli.ts',
      'server/build.ts',
      'server/exit-hook.ts',
      'server/index.ts',
    ],
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

describe('package layering', () => {
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
      const targets = importsOf(path.join(SRC, file))
        // outside src/ entirely: not a layer's business
        .filter(target => !target.startsWith('..'));

      // an import nothing claims means the member lists went stale, and a
      // stale list is indistinguishable from a clean result. So it fails
      // here rather than passing quietly
      const unknown = targets.filter(t => layerOf(t) < 0);
      expect(unknown, 'not in any layer -- LAYERS is out of date').toEqual([]);

      const up = targets
        .map(target => ({ target, layer: layerOf(target) }))
        .filter(t => t.layer > here)
        .map(t => `${t.target} (${LAYERS[t.layer].pkg})`);

      expect(
        up,
        `${LAYERS[here]?.pkg} cannot depend on these`
      ).toEqual([]);
    });
  }
});
