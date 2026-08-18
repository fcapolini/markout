import { Application } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createReloader,
  RELOAD_REQ,
  withReloadScript,
} from '@markout-dev/express';
import { Server } from '../../src/server';

/**
 * The stream itself is exercised with fakes rather than a browser: the suite
 * uses happy-dom for browser work and happy-dom has no `EventSource`, while a
 * real browser would mean launching one per run for a feature whose logic is
 * a set of strings and a set of open responses.
 *
 * What that leaves untested here is whether a browser actually reloads, which
 * was checked by hand against Chromium: editing a file took the page from
 * "version one" to "version two" with exactly two loads -- the initial one and
 * one reload, so the coalescing holds.
 */

/** the parts of an express Response this uses, and nothing else */
function fakeRes() {
  const written: string[] = [];
  let head: [number, Record<string, string>] | undefined;
  let ended = false;
  return {
    written,
    get head() {
      return head;
    },
    get ended() {
      return ended;
    },
    writeHead(status: number, headers: Record<string, string>) {
      head = [status, headers];
      return this;
    },
    write(chunk: string) {
      written.push(chunk);
      return true;
    },
    end() {
      ended = true;
      return this;
    },
  };
}

function fakeReq(p: string) {
  const handlers: Record<string, () => void> = {};
  return {
    path: p,
    on(event: string, fn: () => void) {
      handlers[event] = fn;
      return this;
    },
    fire(event: string) {
      handlers[event]?.();
    },
  };
}

const settle = (ms = 90) => new Promise(r => setTimeout(r, ms));

describe('withReloadScript', () => {
  it('puts the script before </body>', () => {
    expect(withReloadScript('<html><body>hi</body></html>', '<s/>')).toBe(
      '<html><body>hi<s/></body></html>'
    );
  });

  it('appends when there is no </body>', () => {
    // an error page is built by hand, and a page may be authored without one
    expect(withReloadScript('<html>hi</html>', '<s/>')).toBe('<html>hi</html><s/>');
  });

  it('uses the LAST </body>, since the string can appear in content', () => {
    const html = '<html><body><pre>&lt;/body&gt;</pre></body></html>';
    expect(withReloadScript(html, '<s/>')).toBe(
      '<html><body><pre>&lt;/body&gt;</pre><s/></body></html>'
    );
  });
});

describe('reloader', () => {
  it('declines any path but its own', () => {
    const r = createReloader();
    expect(r.handle(fakeReq('/index.html') as any, fakeRes() as any)).toBe(false);
    r.close();
  });

  it('takes over its own path and opens a stream', () => {
    const r = createReloader('boot-1');
    const res = fakeRes();
    expect(r.handle(fakeReq(RELOAD_REQ) as any, res as any)).toBe(true);
    expect(res.head?.[0]).toBe(200);
    expect(res.head?.[1]['Content-Type']).toBe('text/event-stream');
    // the boot id goes out immediately, so a reconnecting page can tell a
    // restarted server from the one it was already talking to
    expect(res.written.join('')).toBe('event: hello\ndata: boot-1\n\n');
    r.close();
  });

  it('notifies every open page, coalescing a burst into one reload', async () => {
    const r = createReloader('boot-1');
    const a = fakeRes();
    const b = fakeRes();
    r.handle(fakeReq(RELOAD_REQ) as any, a as any);
    r.handle(fakeReq(RELOAD_REQ) as any, b as any);

    // one save can produce several watcher events; each must not be a reload
    r.notify();
    r.notify();
    r.notify();
    await settle();

    const reloads = (res: typeof a) =>
      res.written.filter(w => w.startsWith('event: reload')).length;
    expect(reloads(a)).toBe(1);
    expect(reloads(b)).toBe(1);
    r.close();
  });

  it('forgets a stream the client closed', async () => {
    const r = createReloader();
    const res = fakeRes();
    const req = fakeReq(RELOAD_REQ);
    r.handle(req as any, res as any);
    const before = res.written.length;
    req.fire('close');

    r.notify();
    await settle();
    expect(res.written.length).toBe(before);
    r.close();
  });

  it('ends every stream on close', () => {
    const r = createReloader();
    const res = fakeRes();
    r.handle(fakeReq(RELOAD_REQ) as any, res as any);
    r.close();
    expect(res.ended).toBe(true);
  });
});

describe('the middleware in each mode', () => {
  let dir: string;
  let devServer: Server;
  let prodServer: Server;
  let devApp: Application;
  let prodApp: Application;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-reload-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>hi</body></html>');
    fs.writeFileSync(path.join(dir, 'broken.html'), '<html><body><:include src="gone.htm"/></body></html>');
    devServer = await new Server({ docroot: dir, dev: true, logger: () => {} }).start();
    prodServer = await new Server({ docroot: dir, logger: () => {} }).start();
    devApp = devServer.app!;
    prodApp = prodServer.app!;
  });

  afterAll(async () => {
    await devServer.stop();
    await prodServer.stop();
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  });

  it('injects the script in dev', async () => {
    const res = await request(devApp).get('/index.html');
    expect(res.text).toContain('data-markout-reload');
    expect(res.text).toContain('EventSource');
    // inside the document, not trailing after it
    expect(res.text.indexOf('data-markout-reload')).toBeLessThan(
      res.text.lastIndexOf('</body>')
    );
  });

  it('injects nothing outside dev', async () => {
    const res = await request(prodApp).get('/index.html');
    expect(res.text).not.toContain('data-markout-reload');
    expect(res.status).toBe(200);
  });

  it('carries the script on a dev error page, where it matters most', async () => {
    // without this, fixing the file leaves the browser showing the error
    // until somebody presses refresh
    const res = await request(devApp).get('/broken.html');
    expect(res.status).toBe(500);
    expect(res.text).toContain('data-markout-reload');
  });

  it('does not answer the stream path outside dev', async () => {
    // it is not merely unused there: nothing should be listening on a path
    // the deliverable knows nothing about
    const res = await request(prodApp).get(RELOAD_REQ);
    expect(res.status).toBe(404);
  });
});
