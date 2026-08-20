import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { kitsFor } from '../src/pages';
import { resetGlobalNodeModules, setGlobalNodeModules } from '../src/global-kits';

/**
 * The editor has to see the same kits the compiler does, including the ones
 * `npm install -g` put somewhere only npm knows about. See
 * `src/global-kits.ts` for why the extension cannot find them the way the
 * CLI does.
 */

const temps: string[] = [];

afterEach(() => {
  resetGlobalNodeModules();
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** a global install tree, returning what `npm root -g` would print */
function globalRoot(kits: Record<string, string>): string {
  const root = temp('markout-global-');
  const nodeModules = path.join(root, 'lib', 'node_modules');
  for (const [name, kitRoot] of Object.entries(kits)) {
    const dir = path.join(nodeModules, ...name.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, markout: { root: kitRoot } })
    );
  }
  return nodeModules;
}

/** a bare docroot: HTML in a directory, no project around it */
function bareDocroot(): string {
  const dir = path.join(temp('markout-site-'), 'markout');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('globally installed kits, from the editor', () => {
  it('finds them for a docroot with no project around it', () => {
    setGlobalNodeModules(globalRoot({ '@markout-lang/std-kit': '/std-kit' }));
    const found = kitsFor(bareDocroot(), fakeClock());
    expect(found.map((k) => k.name)).toEqual(['@markout-lang/std-kit']);
  });

  it('finds nothing when npm could not be asked', () => {
    setGlobalNodeModules(null);
    expect(kitsFor(bareDocroot(), fakeClock())).toEqual([]);
  });
});

/** kitsFor caches per docroot; a moving clock keeps tests from sharing it */
let tick = 0;
function fakeClock(): () => number {
  tick += 1_000_000;
  const at = tick;
  return () => at;
}
