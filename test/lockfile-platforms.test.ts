import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The lockfile names every platform, not just the one that last ran
 * `npm install`.
 *
 * esbuild and its kind ship one package per platform as *optional*
 * dependencies, and npm resolves them into the lockfile so that `npm ci`
 * installs the right one wherever it runs. On this repository that stopped
 * being true between 2026-06 and 2026-08: every `node_modules/@esbuild/*`
 * entry but `darwin-arm64` was gone, because npm 11 rewrites the lockfile to
 * describe what is INSTALLED, and what is installed on a Mac is the Mac one.
 * Every commit that touched the lockfile carried it forward.
 *
 * Nothing broke, and that is the point: npm resolves an optional platform
 * package at install time even when the lockfile does not pin it, so CI
 * stayed green for two months while the lockfile quietly stopped being the
 * artifact `npm ci` is for. The failure it eventually produces is not ours
 * to see -- it lands on whoever is not on a Mac.
 *
 * So it is checked here rather than remembered. `npm run lockfile` restores
 * it; see scripts/lockfile.mjs, which explains why the recovery needs a
 * clean tree.
 */

const ROOT = path.resolve(__dirname, '..');

interface LockEntry {
  optionalDependencies?: Record<string, string>;
}

function lockfile(): Record<string, LockEntry> {
  const text = fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
  return JSON.parse(text).packages as Record<string, LockEntry>;
}

/**
 * Optional dependencies some package declares and the lockfile does not
 * describe, as `owner -> missing`.
 *
 * Not a list of platform names, which would have to be kept up to date with
 * whatever esbuild supports this month. What is asked instead is the
 * property that matters and needs no maintenance: every optional dependency
 * that anything here declares has an entry. A pruned lockfile fails it by
 * construction, whichever package was pruned and whatever the platform is
 * called.
 */
function unresolvedOptionals(packages: Record<string, LockEntry>): string[] {
  const missing: string[] = [];
  for (const [name, entry] of Object.entries(packages)) {
    for (const dep of Object.keys(entry.optionalDependencies ?? {})) {
      const nested = `${name}/node_modules/${dep}`;
      if (!(nested in packages) && !(`node_modules/${dep}` in packages)) {
        missing.push(`${name || '<root>'} -> ${dep}`);
      }
    }
  }
  return missing;
}

describe('package-lock.json', () => {
  it('describes every optional dependency anything declares', () => {
    expect(unresolvedOptionals(lockfile())).toStrictEqual([]);
  });

  it('fails when a platform is missing, which is what makes it a check', () => {
    // A guard that looks defended and is not is worse than no guard, and
    // this one would pass on an empty lockfile, on one with no optional
    // dependencies anywhere, and on any of the shapes a bad read of the JSON
    // produces. So it is shown failing on the thing it exists for.
    //
    // Against a fixture rather than against the real lockfile: a control
    // that reads the file under test reports the file's state, not the
    // check's, and fails alongside it -- which is exactly what the first
    // version of this did, turning one useful failure into two.
    const whole = {
      'node_modules/bundler': {
        optionalDependencies: { '@bundler/linux-x64': '1.0.0', '@bundler/darwin-arm64': '1.0.0' },
      },
      'node_modules/@bundler/linux-x64': {},
      'node_modules/@bundler/darwin-arm64': {},
    };
    expect(unresolvedOptionals(whole)).toStrictEqual([]);

    const { 'node_modules/@bundler/linux-x64': _gone, ...pruned } = whole;
    expect(unresolvedOptionals(pruned)).toStrictEqual([
      'node_modules/bundler -> @bundler/linux-x64',
    ]);
  });

  it('has something to check, so a silent no-op cannot pass for a clean run', () => {
    // the other half of the same worry: this file asserting nothing at all,
    // on a day the lockfile shape changes under it
    const declared = Object.values(lockfile()).reduce(
      (n, e) => n + Object.keys(e.optionalDependencies ?? {}).length,
      0
    );
    expect(declared).toBeGreaterThan(20);
  });
});
