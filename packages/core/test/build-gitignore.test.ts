import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from '../src/build';

/**
 * The `.gitignore` a build leaves in the directory it chose.
 *
 * `dist/` is generated, and the audience this is for will not think to say so
 * to git -- the same reasoning that puts one inside `.markout/`. Nested
 * rather than a line added to the project's own `.gitignore`, because git
 * honours one at any depth and nobody's file has to be edited.
 *
 * The interesting half is when it does NOT happen. A named outdir is somebody
 * putting the output where they want it, possibly to commit it, and a static
 * host serving a folder out of the repository is exactly how this audience
 * deploys.
 */

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** a docroot with one page, and a sibling to build into */
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-gitignore-'));
  temps.push(root);
  const docroot = path.join(root, 'markout');
  fs.mkdirSync(docroot);
  fs.writeFileSync(path.join(docroot, 'index.html'), '<html><body>hi</body></html>');
  return { root, docroot, outdir: path.join(root, 'dist') };
}

const ignoreIn = (outdir: string) => path.join(outdir, '.gitignore');

describe('a build that chose its own output directory', () => {
  it('writes a .gitignore covering everything, itself included', async () => {
    const { docroot, outdir } = project();
    await build({ docroot, outdir, gitignore: true });
    const text = fs.readFileSync(ignoreIn(outdir), 'utf8');
    // `*` and not `*\n!.gitignore`: nothing here is worth committing, this
    // file least of all, and the next build makes it again
    expect(text).toMatch(/^\*$/m);
    expect(text).not.toContain('!.gitignore');
  });

  it('says what it is and how to be rid of it', async () => {
    const { docroot, outdir } = project();
    await build({ docroot, outdir, gitignore: true });
    const text = fs.readFileSync(ignoreIn(outdir), 'utf8');
    expect(text).toContain('markout build');
    expect(text).toContain('Delete it if you mean to commit the output');
  });

  it('leaves one somebody edited alone', async () => {
    // deleting it is how somebody says they meant to commit the build, and a
    // tool that put it back would be arguing
    const { docroot, outdir } = project();
    fs.mkdirSync(outdir);
    fs.writeFileSync(ignoreIn(outdir), '# mine\n');
    await build({ docroot, outdir, gitignore: true });
    expect(fs.readFileSync(ignoreIn(outdir), 'utf8')).toBe('# mine\n');
  });

  it('still writes the pages', async () => {
    const { docroot, outdir } = project();
    const result = await build({ docroot, outdir, gitignore: true });
    expect(result.errors).toEqual([]);
    expect(fs.existsSync(path.join(outdir, 'index.html'))).toBe(true);
  });
});

describe('a build into a directory the caller named', () => {
  it('writes no .gitignore at all', async () => {
    // `markout build ./site ./public` may well be somebody staging output for
    // a host that serves a committed folder; making it invisible to git
    // would be a surprise found long after the build
    const { docroot, outdir } = project();
    await build({ docroot, outdir });
    expect(fs.existsSync(ignoreIn(outdir))).toBe(false);
    expect(fs.existsSync(path.join(outdir, 'index.html'))).toBe(true);
  });
});
