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

describe('a kit shipping it, so a page says nothing at all', () => {
  // `<:import>` is head-only and a fragment's root attributes land on the
  // element the directive sits in, so `<head>` is the one scope a kit can
  // decorate. That is why the response is read from there too: without it a
  // kit can declare the value and set it, and nothing would ever look.
  const KIT =
    '<lib :server-status=${null} :server-redirect=${null}>' +
    '<:define tag="std-not-found:div" :_status=${(head.status = 404, true)}>' +
    '<:slot>Not found</:slot></:define>' +
    '<:define tag="std-go:logic" ::to="/" :_go=${(head.redirect = to, true)} />' +
    '</lib>';

  it('lets a component be the 404, with no opt-in from the page', async () => {
    const app = site({
      'std.htm': KIT,
      'index.html':
        '<html><head><:import src="/std.htm" /></head>' +
        '<body><std-not-found>no such row</std-not-found></body></html>',
    });

    const res = await request(app).get('/index.html');
    expect(res.status).toBe(404);
    expect(shown(res.text)).toContain('no such row');
  });

  it('lets one redirect', async () => {
    const app = site({
      'std.htm': KIT,
      'index.html':
        '<html><head><:import src="/std.htm" /></head>' +
        '<body><std-go ::to="/login" /></body></html>',
    });

    const res = await request(app).get('/index.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('says nothing while its component is behind an :if that is false', async () => {
    // the whole of what makes the conditional form work. A hidden region is
    // a stencil, its scopes are never live, and a `:server-` value inside
    // one reaches page state as nothing -- so the tag can carry the whole
    // error page, custom markup and all, and cost the successful response
    // its status only when it renders
    const app = site({
      'std.htm': KIT,
      'my404.htm': '<div class="oops"><h1>Nothing here</h1></div>',
      'index.html':
        '<html><head><:import src="/std.htm" /></head><body :row=${{ id: 1 }}>' +
        '<std-not-found :if=${!row}><:include src="/my404.htm" /></std-not-found>' +
        '<p :if=${row}>the row</p></body></html>',
    });

    const res = await request(app).get('/index.html');
    expect(res.status).toBe(200);
    expect(shown(res.text)).toMatch(/>the row</);
    // rendered nowhere -- though the markup does still travel, in the
    // stencil the browser would build it from
    const body = /<body[^>]*>([\s\S]*?)<script/.exec(res.text)?.[1] ?? '';
    expect(body).not.toContain('Nothing here');
  });

  it('and answers with it when the same page finds nothing', async () => {
    const app = site({
      'std.htm': KIT,
      'my404.htm': '<div class="oops"><h1>Nothing here</h1></div>',
      'index.html':
        '<html><head><:import src="/std.htm" /></head><body :row=${null}>' +
        '<std-not-found :if=${!row}><:include src="/my404.htm" /></std-not-found>' +
        '<p :if=${row}>the row</p></body></html>',
    });

    const res = await request(app).get('/index.html');
    expect(res.status).toBe(404);
    expect(shown(res.text)).toContain('<h1>Nothing here</h1>');
  });

  it('leaves the page in charge where it says so itself', async () => {
    const app = site({
      'std.htm': KIT,
      'index.html':
        '<html :server-status=${418}><head><:import src="/std.htm" /></head>' +
        '<body><std-not-found /></body></html>',
    });

    // the kit's component still runs and still writes 404 onto <head>; the
    // page's own statement is the one that answers
    const res = await request(app).get('/index.html');
    expect(res.status).toBe(418);
  });
});

describe('the same, with no kit at all', () => {
  it('is the shorter spelling, and keeps the error page out of a 200', async () => {
    // what the docs recommend over a component: `:server-if` decides once,
    // so the branch that did not show is not in the response. A plain `:if`
    // could not do that -- its condition is live, so the markup has to
    // travel in case the browser turns it
    const page =
      '<html :server-row=${row} :server-status=${row ? 200 : 404}><body>' +
      '<div :server-if=${!row}><:include src="/my404.htm" /></div>' +
      '<article :server-if=${row}>the row</article></body></html>';

    const found = site({
      'my404.htm': '<div><h1>Nothing here</h1></div>',
      'index.html': page.replace('${row}', '${{ id: 1 }}'),
    });
    const ok = await request(found).get('/index.html');
    expect(ok.status).toBe(200);
    expect(shown(ok.text)).toContain('the row');
    expect(ok.text).not.toContain('Nothing here');

    const missing = site({
      'my404.htm': '<div><h1>Nothing here</h1></div>',
      'index.html': page.replace('${row}', '${null}'),
    });
    const gone = await request(missing).get('/index.html');
    expect(gone.status).toBe(404);
    expect(shown(gone.text)).toContain('<h1>Nothing here</h1>');
  });
});
