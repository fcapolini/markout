import { Application } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../src/server/build';
import { Server } from '../../src/server';

/**
 * A kit installed from npm, served and built.
 *
 * The two are tested together on purpose: the whole point of deriving both
 * mount tables from what is INSTALLED is that they cannot disagree, and a
 * resource that is servable in dev but missing from the deliverable is the
 * failure that arrangement exists to prevent. See docs/design/npm-kits.md.
 */

let root: string;
let docroot: string;
let server: Server;
let app: Application;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-kit-serve-'));
  docroot = path.join(root, 'site');
  fs.mkdirSync(docroot);

  const kit = path.join(root, 'node_modules', '@markout-lang', 'bootstrap-kit');
  fs.mkdirSync(path.join(kit, 'res'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'parts'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(
    path.join(kit, 'package.json'),
    JSON.stringify({
      name: '@markout-lang/bootstrap-kit',
      markout: { root: '/bootstrap-kit' },
    })
  );
  fs.writeFileSync(path.join(kit, 'all.htm'), '<lib><:include src="./parts/badge.htm"/></lib>');
  fs.writeFileSync(
    path.join(kit, 'parts', 'badge.htm'),
    '<lib><:define tag="kit-badge:span" :label=${\'none\'} class=${`badge ${label}`}><:slot/></:define></lib>'
  );
  fs.writeFileSync(path.join(kit, 'res', 'logo.png'), 'PNG');
  fs.writeFileSync(path.join(kit, 'res', 'kit.css'), '.badge { color: red }');
  fs.writeFileSync(path.join(kit, '.env'), 'SECRET=1');
  // a showcase page, of the kind a kit may ship and a site may not want
  fs.writeFileSync(path.join(kit, 'showcase.html'), '<html><body>gallery</body></html>');
  fs.writeFileSync(path.join(kit, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1');

  fs.writeFileSync(
    path.join(docroot, 'index.html'),
    '<html><head><:import src="/npm/@markout-lang/bootstrap-kit/all.htm"/></head>' +
      '<body><img src="/bootstrap-kit/res/logo.png">' +
      '<kit-badge :label="ok">shipped</kit-badge></body></html>'
  );

  server = new Server({ docroot, logger: () => {} });
  await server.start();
  app = server.app!;
});

afterAll(async () => {
  await server.stop();
  fs.existsSync(root) && fs.rmSync(root, { recursive: true, force: true });
});

describe('serving a mounted kit', () => {
  it('serves a resource at the kit\'s logical root', async () => {
    const res = await request(app).get('/bootstrap-kit/res/kit.css');
    expect(res.status).toBe(200);
    expect(res.text).toBe('.badge { color: red }');
    expect(res.headers['content-type']).toContain('text/css');
  });

  it('serves a binary resource with the type its extension implies', async () => {
    const res = await request(app).get('/bootstrap-kit/res/logo.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('compiles a page that imported the kit through /npm/', async () => {
    const res = await request(app).get('/index.html');
    expect(res.status).toBe(200);
    // the component came out of node_modules and expanded
    expect(res.text).toContain('class="badge ok"');
    expect(res.text).toContain('shipped');
    // the resource URL passes through untouched: it is a URL, not a path the
    // compiler has any business rewriting
    expect(res.text).toContain('src="/bootstrap-kit/res/logo.png"');
  });

  it('refuses the kit\'s fragments, as it refuses the docroot\'s', async () => {
    expect((await request(app).get('/bootstrap-kit/all.htm')).status).toBe(404);
    expect((await request(app).get('/bootstrap-kit/parts/badge.htm')).status).toBe(404);
  });

  it('refuses /npm/ over HTTP', async () => {
    // the compile-time spelling, which must never be a second URL for bytes
    // the logical root already names
    expect((await request(app).get('/npm/@markout-lang/bootstrap-kit/all.htm')).status).toBe(404);
    expect((await request(app).get('/npm/@markout-lang/bootstrap-kit/res/logo.png')).status).toBe(404);
  });

  it('refuses a dotfile and node_modules inside the kit', async () => {
    expect((await request(app).get('/bootstrap-kit/.env')).status).toBe(404);
    expect((await request(app).get('/bootstrap-kit/node_modules/left-pad/index.js')).status).toBe(404);
  });

  it('serves the package.json, which is public already', async () => {
    // decided rather than overlooked: a published package's tarball is a
    // registry fetch away, so there is nothing here to withhold -- and a kit
    // that published less than a vendored copy of itself would make
    // vendoring a change in behaviour
    expect((await request(app).get('/bootstrap-kit/package.json')).status).toBe(200);
  });

  it('404s a missing file under a kit root', async () => {
    expect((await request(app).get('/bootstrap-kit/res/nope.png')).status).toBe(404);
  });

  it('refuses a kit\'s page when nothing said allow-pages', async () => {
    // the one place this design departs from the symlink equivalence: a kit
    // does not get space in the site's URL namespace for pages unless a page
    // grants it
    expect((await request(app).get('/bootstrap-kit/showcase.html')).status).toBe(404);
  });
});

describe('allow-pages', () => {
  let allowRoot: string;
  let allowApp: Application;
  let allowServer: Server;

  beforeAll(async () => {
    allowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-allow-'));
    const site = path.join(allowRoot, 'site');
    fs.mkdirSync(site);
    const kit = path.join(allowRoot, 'node_modules', 'showy-kit');
    fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(
      path.join(kit, 'package.json'),
      JSON.stringify({ name: 'showy-kit', markout: { root: '/showy-kit' } })
    );
    fs.writeFileSync(path.join(kit, 'all.htm'), '<lib></lib>');
    fs.writeFileSync(path.join(kit, 'showcase.html'), '<html><body>gallery</body></html>');
    fs.writeFileSync(
      path.join(site, 'index.html'),
      '<html><head><:import src="/npm/showy-kit/all.htm" allow-pages/></head><body>mine</body></html>'
    );
    allowServer = new Server({ docroot: site, logger: () => {} });
    await allowServer.start();
    allowApp = allowServer.app!;
  });

  afterAll(async () => {
    await allowServer.stop();
    fs.existsSync(allowRoot) && fs.rmSync(allowRoot, { recursive: true, force: true });
  });

  it('serves the kit\'s page once a page has allowed it', async () => {
    const res = await request(allowApp).get('/showy-kit/showcase.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('gallery');
  });

  it('builds it too, so dev and the deliverable agree', async () => {
    const outdir = path.join(allowRoot, 'out');
    const result = await build({ docroot: path.join(allowRoot, 'site'), outdir });
    expect(result.kitErrors).toEqual([]);
    expect(result.pages.sort()).toEqual(['/index.html', '/showy-kit/showcase.html']);
    expect(fs.existsSync(path.join(outdir, 'showy-kit', 'showcase.html'))).toBe(true);
  });
});

describe('building a mounted kit', () => {
  it('materializes the kit at its logical root', async () => {
    const outdir = path.join(root, 'out');
    const result = await build({ docroot, outdir });

    expect(result.kitErrors).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.pages).toEqual(['/index.html']);
    // exactly what the server serves, by construction rather than by care
    expect(result.assets).toContain('/bootstrap-kit/res/logo.png');
    expect(fs.readFileSync(path.join(outdir, 'bootstrap-kit', 'res', 'logo.png'), 'utf8'))
      .toBe('PNG');

    // and none of what it refuses -- the showcase page included, since
    // nothing in this docroot said allow-pages
    expect(result.pages).not.toContain('/bootstrap-kit/showcase.html');
    expect(fs.existsSync(path.join(outdir, 'bootstrap-kit', 'showcase.html'))).toBe(false);
    expect(fs.existsSync(path.join(outdir, 'bootstrap-kit', 'all.htm'))).toBe(false);
    expect(fs.existsSync(path.join(outdir, 'bootstrap-kit', '.env'))).toBe(false);
    expect(fs.existsSync(path.join(outdir, 'bootstrap-kit', 'node_modules'))).toBe(false);

    // the page carries the component, so the deliverable needs nothing of
    // the kit but its resources
    const html = fs.readFileSync(path.join(outdir, 'index.html'), 'utf8');
    expect(html).toContain('class="badge ok"');
  });

  it('fails the build, writing nothing, when a kit is refused', async () => {
    // a second project, whose docroot already occupies the root its kit
    // claims -- the case `ln -s` would refuse
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-kit-clash-'));
    const site = path.join(other, 'site');
    fs.mkdirSync(path.join(site, 'a-kit'), { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), '<html><body>hi</body></html>');
    const kit = path.join(other, 'node_modules', 'a-kit');
    fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(
      path.join(kit, 'package.json'),
      JSON.stringify({ name: 'a-kit', markout: { root: '/a-kit' } })
    );

    const outdir = path.join(other, 'out');
    const result = await build({ docroot: site, outdir });

    expect(result.kitErrors).toHaveLength(1);
    expect(result.kitErrors[0]).toContain('the docroot already has');
    // decided before anything is read, so nothing is written -- not even the
    // pages that wanted nothing from the kit
    expect(result.pages).toEqual([]);
    expect(fs.existsSync(outdir)).toBe(false);

    fs.rmSync(other, { recursive: true, force: true });
  });
});
