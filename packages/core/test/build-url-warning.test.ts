import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../src/build';

/**
 * A page that reads `$url`, prerendered with no address to read.
 *
 * `$url` is `undefined` where there is no address, and a build has one
 * only when `--origin` said where the pages are going -- supplied rather
 * than guessed, for the reason `$origin` is (see BuildProps.origin). A
 * default would be a lie with consequences: `$origin` comes out of `$url`,
 * so inventing one turns `std-data`'s "nothing is serving this page" into
 * a fetch of a loopback address that isn't there.
 *
 * So the value stays honest and the build says when honesty will surprise
 * you. It cannot say the page is WRONG -- `$url.hash` and `$url?.hash`
 * compile to the same dependency, since `?.` on a member is not a crossing
 * between scopes -- so it says what the page will render instead, which is
 * worth knowing either way: a fragment-routed page built like this is the
 * default route on every address.
 */
let docroot: string;
let outdir: string;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-urlwarn-'));
  outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-urlwarn-out-'));
  fs.writeFileSync(
    path.join(docroot, 'route.html'),
    '<html :route=${$url?.hash.slice(1) || "home"}><body><i>${route}</i></body></html>'
  );
  fs.writeFileSync(path.join(docroot, 'plain.html'), '<html><body><i>hi</i></body></html>');
});
afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
  fs.rmSync(outdir, { recursive: true, force: true });
});

describe('prerendering a page that reads its own address', () => {
  it('names the page, and says what it will render instead', async () => {
    const result = await build({ docroot, outdir, prerender: true, kits: [] });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings.map(w => w.pathname)).toStrictEqual(['/route.html']);
    const msg = result.warnings[0].error.msg;
    expect(msg).toMatch(/reads \$url and there is no address to read/);
    expect(msg).toMatch(/--origin/);
  });

  it('says nothing once the build has been told where the pages live', async () => {
    const result = await build({
      docroot,
      outdir,
      prerender: true,
      kits: [],
      origin: 'http://x.test',
    });

    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([]);
  });
});
