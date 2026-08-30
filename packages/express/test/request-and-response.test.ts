import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markout } from '../src';

/** the served markup with the runtime's text markers taken out */
function shown(html: string): string {
  return html.replace(/<!---[^>]*-->/g, '');
}

/**
 * The two halves of the page/request boundary an application needs and a
 * content site does not.
 *
 * **What this request knows.** `globals` is built once, which is right for
 * a database handle and useless for a session: the visitor is a fact about
 * the request. `requestGlobals` names the same kind of thing and builds it
 * per render, so a page can server-render what belongs to whoever asked
 * rather than shipping a shell that fetches it back.
 *
 * **What the page decides.** A page that knows something the router does
 * not -- that this id is not a row, that this visitor is not signed in --
 * has to be able to say so, and a status is a fact about the response
 * rather than about the markup. `:server-status` and `:server-redirect` on
 * `<html>` are read out of what the render collected.
 */
const docroots: string[] = [];

function site(pages: { [file: string]: string }, props: Record<string, unknown> = {}) {
  const docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-reqres-'));
  docroots.push(docroot);
  for (const [file, html] of Object.entries(pages)) {
    fs.writeFileSync(path.join(docroot, file), html);
  }
  const app = express();
  // a route that authenticates before markout ever sees the request, which
  // is the arrangement `requestGlobals` exists to serve
  app.use((req, _res, next) => {
    (req as unknown as { user?: unknown }).user =
      req.headers['x-user'] ? { name: `${req.headers['x-user']}` } : null;
    next();
  });
  app.use(markout({ docroot, ...props }));
  return app;
}

afterAll(() => {
  docroots.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
});

describe('what this request knows', () => {
  it('server-renders a value built from the request', async () => {
    const app = site(
      {
        'index.html':
          '<html :server-who=${user ? user.name : "nobody"}><body><p>${who}</p></body></html>',
      },
      { requestGlobals: { user: (req: any) => req.user } }
    );

    const signedIn = await request(app).get('/index.html').set('x-user', 'ada');
    expect(signedIn.status).toBe(200);
    // in the markup, not fetched back into it
    expect(shown(signedIn.text)).toContain('<p>ada</p>');

    const anonymous = await request(app).get('/index.html');
    expect(shown(anonymous.text)).toContain('<p>nobody</p>');
  });

  it('refuses to let a page read one outside a :server- value', async () => {
    const app = site(
      { 'index.html': '<html><body><p>${user ? "in" : "out"}</p></body></html>' },
      { requestGlobals: { user: (req: any) => req.user } }
    );

    const res = await request(app).get('/index.html');
    // the name is known to the compiler, so this is a compile error rather
    // than a page that works in dev and is empty in production
    expect(res.status).toBe(500);
  });

  it('still hands over the application-wide ones alongside', async () => {
    const app = site(
      {
        'index.html':
          '<html :server-line=${greet(user ? user.name : "nobody")}>' +
          '<body><p>${line}</p></body></html>',
      },
      {
        globals: { greet: (n: string) => `hello ${n}` },
        requestGlobals: { user: (req: any) => req.user },
      }
    );

    const res = await request(app).get('/index.html').set('x-user', 'grace');
    expect(shown(res.text)).toContain('<p>hello grace</p>');
  });
});

describe('what the page decides', () => {
  it('sets the status it asked for, and still serves its markup', async () => {
    const app = site({
      'index.html':
        '<html :server-status=${404}><body><p>no such thing</p></body></html>',
    });

    const res = await request(app).get('/index.html');
    expect(res.status).toBe(404);
    // the page IS the 404 page: a status is about the response, not about
    // whether the markup is worth sending
    expect(shown(res.text)).toContain('<p>no such thing</p>');
  });

  it('redirects instead of answering, when it says so', async () => {
    const app = site(
      {
        'index.html':
          '<html :server-redirect=${user ? null : "/login"}>' +
          '<body><p>secret</p></body></html>',
      },
      { requestGlobals: { user: (req: any) => req.user } }
    );

    const out = await request(app).get('/index.html');
    expect(out.status).toBe(302);
    expect(out.headers.location).toBe('/login');
    expect(out.text).not.toContain('secret');

    const inside = await request(app).get('/index.html').set('x-user', 'ada');
    expect(inside.status).toBe(200);
    expect(shown(inside.text)).toContain('<p>secret</p>');
  });

  it('takes the status with the redirect when both are given', async () => {
    const app = site({
      'index.html':
        '<html :server-redirect=${"/elsewhere"} :server-status=${301}>' +
        '<body>moved</body></html>',
    });

    const res = await request(app).get('/index.html');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/elsewhere');
  });

  it('leaves a page that says nothing exactly as it was', async () => {
    const app = site({ 'index.html': '<html><body><p>ordinary</p></body></html>' });

    const res = await request(app).get('/index.html');
    expect(res.status).toBe(200);
    expect(shown(res.text)).toContain('<p>ordinary</p>');
  });
});
