import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markout } from '../src';

/**
 * `client: true` -- pages served as `markout build` writes them.
 *
 * The third delivery mode, served rather than written to a directory (see
 * docs/concepts/isomorphism.md). Two things follow from it and both are
 * asserted here, because the second is a security property and a property
 * nobody checks is a property nobody has:
 *
 * 1. **A preview matches the delivery.** A project that ships `build` output
 *    and previews a served render is looking at a page that differs from the
 *    deployed one wherever a render would have supplied something.
 * 2. **No page expression runs in this process**, and so no expression
 *    belonging to a KIT -- third-party code installed by ticking a box in the
 *    editor. Compile-time evaluation is sandboxed and nothing here renders,
 *    so for somebody working through the sidebar a kit's code runs in their
 *    browser and nowhere else. See docs/design/code-execution.md.
 */

/** a value the server would resolve, and a route out of the sandbox */
const PAGE = `<html><body>
  <div :count=\${2}>[\${count * 21}]</div>
  <div :reach=\${''.constructor.constructor('return typeof process')()}>[\${reach}]</div>
</body></html>`;

let docroot: string;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-client-'));
  fs.writeFileSync(path.join(docroot, 'index.html'), PAGE);
});

afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

/**
 * Whether a value was resolved before serialization.
 *
 * Matched around the marker comments a rendered text value is wrapped in --
 * the markup is `[<!---t0-->42<!---/-->]`, so a plain `[42]` matches nothing
 * whatever the mode, which is a way for all of this to pass vacuously.
 */
function rendered(html: string, value: string): boolean {
  return new RegExp(`-->${value}<`).test(html);
}

function appWith(client: boolean) {
  const app = express();
  app.use(markout({ docroot, kits: [], client, logger: () => {} }));
  return app;
}

describe('served mode, for comparison', () => {
  it('resolves values before serialization', async () => {
    const res = await request(appWith(false)).get('/index.html');
    expect(rendered(res.text, '42')).toBe(true);
  });

  it('evaluates page expressions in this process', async () => {
    // the baseline the mode below is measured against: an expression here
    // reaches the host realm, which is what SSR means everywhere
    const res = await request(appWith(false)).get('/index.html');
    expect(rendered(res.text, 'object')).toBe(true);
  });
});

describe('client mode', () => {
  it('serves the page compiled but not rendered', async () => {
    const res = await request(appWith(true)).get('/index.html');
    expect(res.status).toBe(200);
    // the browser produces this on arrival, exactly as it would for a page
    // written by `markout build`
    expect(rendered(res.text, '42')).toBe(false);
  });

  it('still serves markup and the runtime, so the page comes alive', async () => {
    const res = await request(appWith(true)).get('/index.html');
    expect(res.text).toContain('<div');
    expect(res.text).toMatch(/markout-runtime/);
  });

  it('runs no page expression in this process', async () => {
    // the security property: nothing a page -- or a kit spliced into one --
    // wrote is evaluated here, so there is no realm to escape from
    const res = await request(appWith(true)).get('/index.html');
    expect(rendered(res.text, 'object')).toBe(false);
  });
});
