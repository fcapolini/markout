import { execFileSync } from 'child_process';
import fs from 'fs';
import { builtinModules } from 'module';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * What the bundles reach for, which decides whether an installed one runs.
 *
 * A `.vsix` is unzipped somewhere with no `npm install` behind it, so every
 * `require` the two bundles still perform has to be answerable by node or by
 * the extension host. One that is not is invisible everywhere it is easy to
 * look: `vscode-html-languageservice` ships UMD, whose wrapper passes
 * `require` in as an ARGUMENT, and a shadowed `require` is one esbuild leaves
 * standing -- so the server built clean, packaged clean, installed clean and
 * died on its first question with "Cannot find module ./parser/htmlScanner".
 *
 * Built into a directory of its own rather than read out of `dist/`: the
 * suite next door builds too, and two of them writing the same file is a
 * race that would fail for a reason that has nothing to do with anything.
 */

const PACKAGE = path.resolve(__dirname, '..');
let outdir: string;

beforeAll(() => {
  outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-bundle-'));
  execFileSync(
    process.execPath,
    [path.join(PACKAGE, 'scripts', 'bundle.mjs'), '--outdir', outdir, '--quiet'],
    { cwd: PACKAGE, stdio: 'ignore' }
  );
}, 60000);

// `markout-cli.js` is included, and is the one most likely to fail this:
// it bundles express, which is a package full of `require` calls written
// before bundlers existed. It is also the one whose failure is quietest --
// it runs in a child process, so a missing module surfaces as a preview
// that never comes up rather than as anything in the editor.
describe.each(['client.js', 'server.js', 'markout-cli.js'])('%s', file => {
  it('asks for nothing by name but `vscode` and node itself', () => {
    const text = fs.readFileSync(path.join(outdir, file), 'utf8');
    const asked = new Set<string>();
    // `require2(...)` and the rest: esbuild renames a shadowed `require`,
    // and a renamed one is exactly the case it could not follow
    for (const [, id] of text.matchAll(/\brequire\d*\(\s*["']([^"']+)["']\s*\)/g)) {
      asked.add(id);
    }
    const outside = [...asked].filter(
      id => id !== 'vscode' && !builtinModules.includes(id.replace(/^node:/, ''))
    );
    expect(outside).toStrictEqual([]);
  });

  it('is a bundle rather than a re-export of the sources', () => {
    // a build that emitted a wrapper around out/ would pass the check above
    // by asking for nothing, and ship nothing
    expect(fs.statSync(path.join(outdir, file)).size).toBeGreaterThan(100_000);
  });
});
