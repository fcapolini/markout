import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';

/**
 * What a compiled page says built it.
 *
 * `<meta name="generator" content="Markout">`, appended to `<head>`, which
 * is how a generator has identified itself since long before this one and
 * what everything counting the web reads. See stage7-generate's
 * injectGenerator for why it goes at the END, why it carries no version,
 * and why a page that already names a generator keeps its own.
 */
let docroot: string;
let seq = 0;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-generator-'));
});
afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

async function page(source: string, generator?: boolean) {
  const name = `g${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), source);
  const compiled = await new Compiler({ docroot, generator }).compile(`/${name}`);
  expect(compiled.errors.map(e => e.msg)).toStrictEqual([]);
  return compiled.source.doc.toString();
}

async function head(source: string, generator?: boolean) {
  const html = await page(source, generator);
  return html.slice(0, html.indexOf('<body'));
}

describe('the generator meta', () => {
  it('is appended to the head the author wrote', async () => {
    // last, and not merely tidiness: a document's <meta charset> is only
    // honoured within the first 1024 bytes, so anything inserted at the TOP
    // of a head pushes a late-declared one towards that edge
    const out = await head(
      '<html><head><meta charset="utf-8"><title>t</title></head><body>b</body></html>'
    );
    expect(out).toContain('<meta name="generator" content="Markout">');
    expect(out.indexOf('charset')).toBeLessThan(out.indexOf('generator'));
    expect(out.indexOf('<title>')).toBeLessThan(out.indexOf('generator'));
  });

  it('comes before the machinery, which is appended to the head too', async () => {
    const out = await head(
      '<html><head><title>t</title></head><body><p :if=${false}>x</p></body></html>'
    );
    expect(out.indexOf('generator')).toBeLessThan(out.indexOf('data-markout-stencil'));
  });

  it('carries no version', async () => {
    // a version names the release to look up advisories for, and would
    // rewrite every built page on every one of them
    expect(await head('<html><head></head><body>b</body></html>')).toMatch(
      /content="Markout"/
    );
  });

  it('leaves a page that already names a generator alone', async () => {
    const out = await head(
      '<html><head><meta name="Generator" content="Mine"></head><body>b</body></html>'
    );
    // matched however it is spelled: a meta's name is ASCII case-insensitive
    expect(out).toContain('content="Mine"');
    expect(out).not.toContain('Markout');
  });

  it('leaves one alone wherever the page put it', async () => {
    // invalid markup, and unambiguous about what its author meant. A second
    // declaration contradicting it is the worse of the two readings
    const inBody = await page(
      '<html><head></head><body><meta name="generator" content="InBody"></body></html>'
    );
    expect(inBody.match(/name="generator"/g)).toHaveLength(1);
    expect(inBody).toContain('content="InBody"');

    // including one a region renders, which is still the page saying so
    const inRegion = await page(
      '<html><head></head><body><meta name="generator" content="Maybe" :if=${false}>' +
        '</body></html>'
    );
    expect(inRegion.match(/name="generator"/g)).toHaveLength(1);
  });

  it('takes the one an imported fragment contributes', async () => {
    fs.writeFileSync(
      path.join(docroot, 'gen-lib.htm'),
      '<lib><meta name="generator" content="Fragment"></lib>'
    );
    const out = await head(
      '<html><head><:import src="gen-lib.htm"/></head><body>b</body></html>'
    );
    expect(out).toContain('content="Fragment"');
    expect(out).not.toContain('Markout');
  });

  it('is added once however many times a page is compiled', async () => {
    // the compiled document is cached and re-rendered per request, and a
    // stage that appended would be one more thing accumulating in it
    const name = `g${seq++}.html`;
    fs.writeFileSync(
      path.join(docroot, name),
      '<html><head></head><body>b</body></html>'
    );
    const compiler = new Compiler({ docroot });
    const first = (await compiler.compile(`/${name}`)).source.doc.toString();
    const again = (await compiler.compile(`/${name}`)).source.doc.toString();
    expect(first.match(/name="generator"/g)).toHaveLength(1);
    expect(again.match(/name="generator"/g)).toHaveLength(1);
  });

  it('is not there when the compiler is told not to', async () => {
    const out = await head('<html><head><title>t</title></head><body>b</body></html>', false);
    expect(out).not.toContain('generator');
  });
});
