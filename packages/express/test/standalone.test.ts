import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_CODE_REQ, markout } from '../src';

/**
 * The package used the way its README will tell an application to use it:
 * `app.use(markout({ docroot }))` on an Express app the caller made, with no
 * `Server` anywhere.
 *
 * Every other test of this middleware reaches it through the CLI's `Server`,
 * which is convenient and also the one arrangement an application will never
 * have. So this is the case that would break silently -- a dependency that
 * only resolves because the CLI happens to install it, a piece of setup only
 * `Server` performs -- and it is the reason this file exists rather than
 * being one more test over there.
 */

const PAGE = `<html><body>
  <div :count=\${2}>\${count * 21}</div>
</body></html>`;

describe('markout() on an application\'s own express app', () => {
  let docroot: string;
  let app: express.Application;

  beforeAll(() => {
    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-express-'));
    fs.writeFileSync(path.join(docroot, 'index.html'), PAGE);
    fs.writeFileSync(path.join(docroot, 'note.txt'), 'plain');
    app = express();
    app.use(markout({ docroot, kits: [] }));
    app.use(express.static(docroot));
  });

  afterAll(() => {
    fs.rmSync(docroot, { recursive: true, force: true });
  });

  it('renders a page server-side', async () => {
    const res = await request(app).get('/index.html');
    expect(res.status).toBe(200);
    // the value is computed before the response is written, not after the
    // browser has the page -- which is the whole claim being checked here
    expect(res.text).toContain('42');
  });

  it('serves the browser runtime the page asks for', async () => {
    const res = await request(app).get(CLIENT_CODE_REQ);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('passes anything that is not a page to the next handler', async () => {
    // `next()` rather than a 404 is what lets an application keep its own
    // static layer, its API and its routes
    const res = await request(app).get('/note.txt');
    expect(res.status).toBe(200);
    expect(res.text).toBe('plain');
  });

  it('is mounted AFTER the application\'s own routes', async () => {
    // A path with no extension is a page request -- `/about` is how a page
    // is asked for without naming a file -- so the middleware answers it,
    // with a 404 when no page resolves, rather than passing it on. An API
    // route therefore has to be registered before this is mounted, which is
    // the order kits/bootstrap/server.ts uses and the order the README has
    // to state. Asserted in both directions so the requirement cannot
    // quietly stop being true.
    const before = express();
    before.get('/api/thing', (_req, res) => {
      res.json({ ok: true });
    });
    before.use(markout({ docroot, kits: [] }));
    const ok = await request(before).get('/api/thing');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });

    const after = express();
    after.use(markout({ docroot, kits: [] }));
    after.get('/api/thing', (_req, res) => {
      res.json({ ok: true });
    });
    expect((await request(after).get('/api/thing')).status).toBe(404);
  });
});
