import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kitsFor } from '../src/pages';
import {
  globalNodeModules,
  resetGlobalNodeModules,
  setGlobalNodeModules,
} from '../src/global-kits';

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

/**
 * The editor host's PATH is not the user's, and on macOS it usually is not:
 * an editor started from the Dock inherits launchd's, which holds no
 * Homebrew and no version manager. So `npm` on the PATH is the fast way of
 * asking, not the only one -- see `src/global-kits.ts`.
 */
describe('asking npm where global packages are', () => {
  // these tests are about the lookup itself, so they undo what test/setup.ts
  // pins for everybody else
  beforeEach(resetGlobalNodeModules);

  it('takes what npm printed', () => {
    expect(globalNodeModules({ npm: () => '/opt/homebrew/lib/node_modules\n' })).toBe(
      '/opt/homebrew/lib/node_modules'
    );
  });

  it('answers "none yet" while the login shell is being asked', () => {
    let asked: (out: string | null) => void = () => {};
    const shell = (done: (out: string | null) => void) => (asked = done);
    expect(globalNodeModules({ npm: () => null, shell })).toBe(null);
    asked('/Users/x/.nvm/versions/node/v24.0.0/lib/node_modules');
    expect(globalNodeModules({ npm: notCalled, shell })).toBe(
      '/Users/x/.nvm/versions/node/v24.0.0/lib/node_modules'
    );
  });

  it('asks the login shell once, however often it is asked', () => {
    let asks = 0;
    const shell = () => {
      asks++;
    };
    globalNodeModules({ npm: () => null, shell });
    globalNodeModules({ npm: notCalled, shell });
    globalNodeModules({ npm: notCalled, shell });
    expect(asks).toBe(1);
  });

  it('settles on nothing when the login shell has none either', () => {
    const shell = (done: (out: string | null) => void) => done(null);
    expect(globalNodeModules({ npm: () => null, shell })).toBe(null);
    expect(globalNodeModules({ npm: notCalled, shell: notCalled })).toBe(null);
  });

  it('ignores whatever an interactive shell printed before the answer', () => {
    const shell = (done: (out: string | null) => void) =>
      done('nvm: version 0.40.1\n/usr/local/lib/node_modules\n');
    globalNodeModules({ npm: () => null, shell });
    expect(globalNodeModules({ npm: notCalled, shell: notCalled })).toBe(
      '/usr/local/lib/node_modules'
    );
  });
});

/** a probe that must not run: calling it fails the test rather than lying */
function notCalled(): never {
  throw new Error('asked again after the answer was known');
}

/** kitsFor caches per docroot; a moving clock keeps tests from sharing it */
let tick = 0;
function fakeClock(): () => number {
  tick += 1_000_000;
  const at = tick;
  return () => at;
}
