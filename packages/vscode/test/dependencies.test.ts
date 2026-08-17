import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The extension does not carry a web server into the editor.
 *
 * This is the claim the whole monorepo split was made to satisfy -- see
 * docs/design/monorepo.md, where the language server is named as the forcing
 * case and everything else is described as something that could have limped
 * along in one package. So it is worth an assertion rather than an intention:
 * one careless import of `@markout/express`, or of the CLI, and an editor
 * process is running express, compression and commander for no reason.
 *
 * Checked against the declared dependency closure of the workspace packages,
 * which is what an install actually resolves.
 */

const ROOT = path.resolve(__dirname, '../../..');
const FORBIDDEN = ['express', 'compression', 'commander', '@markout/express', 'markout'];

/** a workspace package's package.json, by name */
function manifest(dir: string): { name: string; dependencies?: Record<string, string> } {
  return JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'));
}

const WORKSPACE_DIRS: { [name: string]: string } = {
  '@markout/core': 'packages/core',
  '@markout/express': 'packages/express',
  markout: 'packages/cli',
  'markout-vscode': 'packages/vscode',
};

/** every dependency reachable from a package, following workspace links */
function closureOf(name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name)) {
    return seen;
  }
  seen.add(name);
  const dir = WORKSPACE_DIRS[name];
  if (!dir) {
    // outside the workspace: its own dependencies are npm's business, and
    // none of the forbidden names is a transitive dependency of a parser
    return seen;
  }
  for (const dep of Object.keys(manifest(dir).dependencies ?? {})) {
    closureOf(dep, seen);
  }
  return seen;
}

describe('what the extension installs', () => {
  it('depends on the compiler and nothing else of ours', () => {
    const direct = Object.keys(manifest('packages/vscode').dependencies ?? {});
    expect(direct.filter(d => d.startsWith('@markout/'))).toStrictEqual(['@markout/core']);
  });

  it('has no web server anywhere in its closure', () => {
    const closure = closureOf('markout-vscode');
    expect([...closure].filter(d => FORBIDDEN.includes(d))).toStrictEqual([]);
  });

  it('would notice if that stopped being true', () => {
    // the CLI is the package that legitimately has all of it, so finding
    // nothing there would mean the walk is looking at nothing
    const closure = closureOf('markout');
    expect([...closure].filter(d => FORBIDDEN.includes(d)).sort()).toStrictEqual([
      '@markout/express',
      'commander',
      'compression',
      'express',
      'markout',
    ]);
  });
});
