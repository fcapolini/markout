import { Application } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from '../../src/server';
import { Compiler } from '@markout-dev/core';
import { renderPage } from '@markout-dev/core';

/**
 * The middleware keeps compiled pages in memory and renders each request
 * against the one it kept.
 *
 * Two things have to hold for that to be allowed, and one of them did not.
 * A render has to be REPEATABLE, since the same document is written into
 * once per request -- writing the markup always was, being the same
 * overwrite the browser performs when it hydrates, but `emitState`
 * appended, so a page served twice carried two `window.__MARKOUT_STATE`
 * assignments and served ten carried ten. And what is cached has to be the
 * COMPILER's output only: a `:server-` value runs per request by
 * definition, so caching HTML would hand one visitor's data to the next.
 */

function tmp(prefix: string, files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

describe('rendering a compiled page more than once', () => {
  it('produces the same document every time', async () => {
    const dir = tmp('markout-render-twice-', {
      'p.html': '<html><body :server-n=${1 + 1} :m=${3}>${n}/${m}</body></html>',
    });
    try {
      const page = await new Compiler({ docroot: dir }).compile('/p.html');
      expect(page.errors).toStrictEqual([]);
      const outs: string[] = [];
      for (let i = 0; i < 3; i++) {
        expect(await renderPage(page)).toStrictEqual([]);
        outs.push(page.source.doc.toString());
      }
      expect(outs[1]).toBe(outs[0]);
      expect(outs[2]).toBe(outs[0]);
      // markers sit between the two interpolations, so read past them
      expect(outs[0].replace(/<!---[^>]*-->/g, '')).toContain('2/3');
      // the exact way it used to drift
      expect(outs[2].match(/__MARKOUT_STATE = /g)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('puts the state script back when a later render has something to send', async () => {
    // the awkward half of being repeatable. A render with nothing sendable
    // REMOVES the script rather than leave an empty one behind -- so a
    // later render of that same page has to know where it stood
    const dir = tmp('markout-render-state-', {
      'p.html': '<html><body :server-n=${src.get()}>${n}</body></html>',
    });
    try {
      const page = await new Compiler({ docroot: dir, serverGlobals: ['src'] }).compile('/p.html');
      expect(page.errors).toStrictEqual([]);

      // a function cannot be sent, so this render has nothing to say
      let answer: unknown = () => 1;
      const globals = { src: { get: () => answer } };
      const first = await renderPage(page, { globals });
      expect(first.map(e => e.phase)).toStrictEqual(['transfer']);
      expect(page.source.doc.toString()).not.toContain('__MARKOUT_STATE');

      // the next request's data is sendable, as a datasource's would be
      answer = 7;
      expect(await renderPage(page, { globals })).toStrictEqual([]);
      const withState = page.source.doc.toString();
      expect(withState).toContain('__MARKOUT_STATE');
      expect(withState).toContain('"n":7');
      // and it is still repeatable from there
      expect(await renderPage(page, { globals })).toStrictEqual([]);
      expect(page.source.doc.toString()).toBe(withState);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the middleware page cache', () => {
  let dir: string;
  let server: Server;
  let app: Application;

  beforeAll(async () => {
    dir = tmp('markout-page-cache-', {
      'lib.htm': '<lib><:define tag="my-bit:i">one</:define></lib>',
      'p.html': '<html><head><:import src="/lib.htm" /></head><body><my-bit /></body></html>',
    });
    server = new Server({ docroot: dir });
    await server.start();
    app = server.app!;
  });

  afterAll(async () => {
    await server.stop();
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves a page repeatedly without accumulating anything', async () => {
    const bodies: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(app).get('/p.html');
      expect(res.status).toBe(200);
      bodies.push(res.text);
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('one');
  });

  it('picks up an edit to a file the page merely imports', async () => {
    // why invalidation is blunt: the page itself did not change, and
    // working out which pages saw which file is the part worth skipping
    expect((await request(app).get('/p.html')).text).toContain('one');
    fs.writeFileSync(path.join(dir, 'lib.htm'), '<lib><:define tag="my-bit:i">two</:define></lib>');
    await new Promise(r => setTimeout(r, 400));
    const after = (await request(app).get('/p.html')).text;
    expect(after).toContain('two');
    expect(after).not.toContain('>one<');
  });
});
