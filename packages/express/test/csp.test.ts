import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cspNonce, markout } from '../src';

/**
 * A served page carries scripts the author did not write -- the props, the
 * transferred state, the runtime, and in dev the reload script -- so a site
 * with a Content-Security-Policy needs a way to name them. `csp` mints the
 * nonce and stamps them; writing the header stays the application's, which
 * is what these tests are shaped around: none of them assert a header,
 * because markout sends none.
 */

const PAGE = `<html><body>
  <div :count=\${2}>\${count * 21}</div>
</body></html>`;

const SERVER_PAGE = `<html><body>
  <div :server-n=\${41}>\${n + 1}</div>
</body></html>`;

function nonces(html: string): string[] {
  return [...html.matchAll(/nonce="([^"]*)"/g)].map(m => m[1]);
}

function scriptCount(html: string): number {
  return [...html.matchAll(/<script\b/g)].length;
}

describe('csp', () => {
  let docroot: string;

  beforeAll(() => {
    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-csp-'));
    fs.writeFileSync(path.join(docroot, 'index.html'), PAGE);
    fs.writeFileSync(path.join(docroot, 'server.html'), SERVER_PAGE);
  });

  afterAll(() => {
    fs.rmSync(docroot, { recursive: true, force: true });
  });

  function serve(props: Omit<Parameters<typeof markout>[0], 'docroot'> = {}) {
    const app = express();
    app.use(markout({ docroot, kits: [], ...props }));
    return app;
  }

  it('stamps nothing unless asked', async () => {
    const res = await request(serve()).get('/index.html');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('nonce');
  });

  it('stamps every script it injected, and no others', async () => {
    const res = await request(serve({ csp: true })).get('/server.html');
    const found = nonces(res.text);

    // props, state and runtime: a policy that names all but one of them is
    // a policy that breaks the page
    expect(found).toHaveLength(scriptCount(res.text));
    expect(new Set(found).size).toBe(1);
    expect(found[0]).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
  });

  it('mints a different one per response', async () => {
    const app = serve({ csp: true });
    const first = nonces((await request(app).get('/index.html')).text);
    const second = nonces((await request(app).get('/index.html')).text);

    // the page is compiled once and cached, so this is also the assertion
    // that a render does not leave the previous request's nonce behind
    expect(first[0]).not.toBe(second[0]);
    expect(second).not.toContain(first[0]);
  });

  it('uses the application\'s own nonce when it has one', async () => {
    // helmet mints `res.locals.cspNonce` before this middleware runs, and
    // one page cannot have two nonces
    const app = express();
    app.use((_req, res, next) => {
      res.locals.cspNonce = 'from-the-app';
      next();
    });
    app.use(markout({ docroot, kits: [], csp: (_req, res) => res.locals.cspNonce }));

    const res = await request(app).get('/index.html');
    expect(new Set(nonces(res.text))).toStrictEqual(new Set(['from-the-app']));
  });

  it('takes the one cspNonce() minted, so the header can be written first', async () => {
    // The order that matters: markout ANSWERS a page request, so nothing
    // mounted after it runs and the header has to go out on the way IN --
    // by which time the nonce has to exist. If `csp: true` minted its own
    // regardless, the page would carry a token its policy never heard of
    const app = express();
    app.use(cspNonce());
    app.use((_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        `script-src 'nonce-${res.locals.markoutNonce}'`
      );
      next();
    });
    app.use(markout({ docroot, kits: [], csp: true }));

    const res = await request(app).get('/index.html');
    const found = nonces(res.text);
    expect(found).toHaveLength(scriptCount(res.text));
    expect(res.headers['content-security-policy']).toBe(
      `script-src 'nonce-${found[0]}'`
    );
  });

  it('mints its own when nothing else did', async () => {
    const res = await request(serve({ csp: true })).get('/index.html');
    expect(nonces(res.text)[0]).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
  });

  it('stamps nothing when the caller returns no nonce for this request', async () => {
    // a policy that applies to some routes and not others
    const app = serve({ csp: () => '' });
    const res = await request(app).get('/index.html');

    expect(res.text).not.toContain('nonce');
  });

  it('covers the dev reload script too', async () => {
    // the one script added after the document was serialized, so the one a
    // policy would otherwise reject -- on the dev server, which is where an
    // application meets this feature first
    const app = serve({ dev: true, csp: true });
    const res = await request(app).get('/index.html');

    expect(res.text).toContain('data-markout-reload');
    expect(nonces(res.text)).toHaveLength(scriptCount(res.text));
    expect(new Set(nonces(res.text)).size).toBe(1);
  });

  it('covers the not-found page', async () => {
    fs.writeFileSync(path.join(docroot, '404.html'), '<html><body>gone</body></html>');
    const res = await request(serve({ csp: true })).get('/nope.html');

    expect(res.status).toBe(404);
    expect(nonces(res.text)).toHaveLength(scriptCount(res.text));
  });
});
