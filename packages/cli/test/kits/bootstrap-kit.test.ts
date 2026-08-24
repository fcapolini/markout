import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Compiler, discoverKits } from '@markout-lang/core';
import { renderPage } from '@markout-lang/core';
import { createSite } from '../../../../sites/site/server';

/**
 * The Bootstrap kit, compiled and rendered as a page would be.
 *
 * This is the language's own regression suite as much as the kit's: the kit
 * is the largest thing written IN markout in this repo, so a change to
 * scoping, replication or slots shows up here before it shows up in anyone's
 * page. Every bug the kit turned up while it was being written -- a stencil
 * evaluating its subtree, a name declared in slotted markup, an
 * interpolation inside a `<textarea>` -- was found exactly this way.
 *
 * Nothing here reaches the network. The kit's Bootstrap URLs are tokens --
 * there so a page under a content security policy, an offline build or a
 * custom Sass build can point the kit at its own copy -- and the tests are
 * simply another caller doing that. What is under test is the markup markout
 * produces, not what a CDN serves.
 */

/** the site, whose pages use the kit; the kit itself is an installed package */
const SITE_ROOT = path.resolve(__dirname, '../../../../sites/site');
/** the kit packages themselves, for the tests that vendor one into a docroot */
const KIT_DIR = path.resolve(__dirname, '../../../../kits/bootstrap-kit');
const STD_KIT_DIR = path.resolve(__dirname, '../../../../kits/std-kit');
const PARTS_DIR = path.join(KIT_DIR, 'parts');

/**
 * Orbit fetches its data while rendering, so compiling it here means
 * standing in for whatever serves it.
 *
 * What that is now is the docroot itself: the console's data is a directory
 * of JSON files under `demos/orbit/api/`, with no application server
 * anywhere. So the stub is a static host in six lines -- it reads the file
 * the URL names -- and the page is checked against the same bytes a visitor
 * is served, without a socket.
 *
 * `fetch` is a global the runtime reads off `globalThis` when a context is
 * built, so replacing it is all it takes.
 */
const ORIGIN = 'http://orbit.test';
const realFetch = globalThis.fetch;

beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: string, init: RequestInit) => {
    const url = new URL(`${input}`);
    // the live-browser suite below runs a real server in this process, and
    // its renders fetch their own data over loopback. Those are the one kind
    // of request that must NOT be answered from here: what they are checking
    // is that the whole stack serves them
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return realFetch(input, init);
    }
    const file = path.normalize(path.join(SITE_ROOT, url.pathname));
    return url.origin === ORIGIN && file.startsWith(SITE_ROOT) && fs.existsSync(file)
      ? {
          ok: true, status: 200, statusText: 'OK',
          json: async () => JSON.parse(fs.readFileSync(file, 'utf8')),
        }
      : { ok: false, status: 404, statusText: 'Not Found', json: async () => null };
  }) as unknown as typeof fetch);
});
afterAll(() => vi.restoreAllMocks());

/**
 * The kits these pages use, discovered once.
 *
 * Discovered from SITE_ROOT rather than from each docroot because one test
 * below builds its docroot in a temp directory, where walking up finds no
 * `node_modules` at all. A kit records an absolute directory, so where it
 * was found and where the pages live are independent -- which is also what
 * lets an application install a kit anywhere above its docroot.
 */
const KITS = discoverKits(SITE_ROOT).kits;

async function compile(docroot: string, pathname: string) {
  // the Compiler takes what is INSTALLED rather than discovering it itself,
  // so a caller passing kits here is doing exactly the middleware's job
  const page = await new Compiler({ docroot, kits: KITS }).compile(pathname);
  const errors = page.errors.map(e => e.msg);
  const runtime = errors.length
    ? []
    : (await renderPage(page, { origin: ORIGIN })).map(e => `${e.phase}: ${e.message}`);
  return { page, errors, runtime, markup: page.source.doc.toString() };
}

/** what a browser would act on: the live document, with stencils and comments out */
function live(markup: string): string {
  return markup
    .replace(/<template>[\s\S]*?<\/template>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function attrValues(markup: string, attr: string): string[] {
  return [...markup.matchAll(new RegExp(`\\s${attr}="([^"]*)"`, 'g'))].map(m => m[1]);
}

describe('every part stands on its own', () => {
  // the kit's own promise: `all.htm` for everything, or one part for one
  // component. A part that quietly relies on another having been imported
  // first works in the showcase and fails for the person who took two.
  let docroot: string;

  beforeAll(() => {
    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-kit-'));
    fs.cpSync(KIT_DIR, path.join(docroot, 'bootstrap-kit'), {
      recursive: true,
    });
  });

  afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

  const parts = fs
    .readdirSync(PARTS_DIR)
    .filter(f => f.endsWith('.htm'))
    .sort();

  it('finds the parts', () => {
    // a directory rename would otherwise turn this whole suite into a no-op
    expect(parts.length).toBeGreaterThan(20);
  });

  it.each(parts)('compiles %s alone', async part => {
    const file = `probe-${part.replace('.htm', '')}.html`;
    fs.writeFileSync(
      path.join(docroot, file),
      `<html><head><:import src="/bootstrap-kit/parts/${part}" />` +
        `<title>t</title></head><body></body></html>`
    );
    const { errors, runtime } = await compile(docroot, `/${file}`);
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
  });
});

/**
 * The cases a component only reaches when a parameter is LEFT OUT.
 *
 * Both of these were silently broken for as long as they existed, and for
 * the same reason: a region held two things and was gated on one of them, so
 * omitting that one took the other with it. The showcase passes every
 * parameter, which is exactly why it never showed either.
 */
describe('components with a parameter left out', () => {
  let docroot: string;

  beforeAll(() => {
    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-kit-min-'));
    fs.cpSync(KIT_DIR, path.join(docroot, 'bootstrap-kit'), { recursive: true });
  });

  afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

  async function render(body: string) {
    const file = `min-${Math.abs(hash(body))}.html`;
    fs.writeFileSync(
      path.join(docroot, file),
      `<html><head><:import src="/bootstrap-kit/all.htm" /><title>t</title></head>` +
        `<body>${body}</body></html>`
    );
    const { errors, runtime, markup } = await compile(docroot, `/${file}`);
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    // the served <body> alone, without the props: every class name this
    // asserts on also appears in there, as the expression that would produce
    // it, so the whole document is the wrong thing to search. The props data
    // block is the first thing markout appends
    const shown = live(markup);
    return shown
      .slice(shown.indexOf('<body'), shown.indexOf('<script type="application/json"'))
      .replace(/ data-markout="[^"]*"/g, '');
  }

  it('a toast with no title can still be closed', async () => {
    // `:autohide=${false}` and no `:title` is a toast that stays until it is
    // dismissed, and the close button used to live only in the header
    const out = await render(
      '<bs-toast ::autohide=${false}>headerless</bs-toast>'
    );
    expect(out).not.toContain('toast-header');
    expect(out).toMatch(/<div class="d-flex">/);
    expect(out).toMatch(/class="btn-close me-2 m-auto"[^>]*data-bs-dismiss="toast"/);
  });

  it('a titled toast keeps the header, and only one close button', async () => {
    const out = await render('<bs-toast ::title="Saved">titled</bs-toast>');
    expect(out).toContain('toast-header');
    expect(out).not.toContain('d-flex');
    expect(out.match(/btn-close/g)).toHaveLength(1);
  });

  it('a range shows its value with no label to hang it on', async () => {
    const out = await render('<bs-range ::showValue=${true} />');
    expect(out).toContain('<span class="text-body-secondary">50</span>');
    // pushed to the right the way it sits beside a label, which needs the
    // justification SWAPPED: Bootstrap emits `justify-content-end` before
    // `justify-content-between`, so the two together leave `between` winning
    expect(out).toContain('justify-content-end');
    expect(out).not.toContain('justify-content-between');
    // and no <label>, whose accessible name would have been "50"
    expect(out).not.toContain('<label');
  });

  it('a range with a label keeps the pair apart', async () => {
    const out = await render('<bs-range ::label="Size" ::showValue=${true} />');
    expect(out).toContain('justify-content-between');
    expect(out).not.toContain('justify-content-end');
    expect(out).toMatch(/<label for="[^"]*">Size<\/label>/);
  });

  it('a range with neither renders no row at all', async () => {
    const out = await render('<bs-range />');
    expect(out).not.toContain('form-label');
  });
});

/** a stable filename per case, so a rerun overwrites rather than accumulates */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

describe('the showcase', () => {
  let result: Awaited<ReturnType<typeof compile>>;

  beforeAll(async () => {
    // the real page, not a copy: it uses every component the kit defines,
    // which is what makes it worth compiling here
    result = await compile(SITE_ROOT, '/demos/kitchen-sink.html');
  });

  it('compiles and renders with nothing reported', () => {
    expect(result.errors).toStrictEqual([]);
    expect(result.runtime).toStrictEqual([]);
  });

  it('instantiates every custom tag', () => {
    // a `bs-` tag left in the output is a usage the compiler didn't match to
    // a definition -- it renders as an unknown element, i.e. as nothing
    const leftovers = [...live(result.markup).matchAll(/<(bs-[a-z-]+)/g)].map(m => m[1]);
    expect([...new Set(leftovers)]).toStrictEqual([]);
  });

  it('gives every element a unique id', () => {
    // ids are built from `$id` so that a component can be used twice; a
    // collision means one of them stopped doing that
    const ids = attrValues(live(result.markup), 'id');
    expect(ids.length).toBeGreaterThan(10);
    expect([...new Set(ids)]).toHaveLength(ids.length);
  });

  it.each([
    ['aria-controls', (v: string) => v],
    ['aria-labelledby', (v: string) => v],
    ['aria-describedby', (v: string) => v],
    ['for', (v: string) => v],
    ['data-bs-target', (v: string) => (v.startsWith('#') ? v.slice(1) : '')],
    ['data-bs-parent', (v: string) => (v.startsWith('#') ? v.slice(1) : '')],
  ])('resolves every %s to an element that exists', (attr, toId) => {
    // the whole reason these components exist: two elements referring to one
    // another by an id nobody typed. A reference with no target is a modal
    // that doesn't open or a label that names nothing, and neither throws
    const markup = live(result.markup);
    const ids = new Set(attrValues(markup, 'id'));
    const refs = attrValues(markup, attr).map(toId).filter(id => id);
    // without this the check passes by finding nothing to check, which is
    // exactly what would happen if a component stopped emitting the
    // attribute at all
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter(id => !ids.has(id))).toStrictEqual([]);
  });

  it('names every control and landmark it should', () => {
    const markup = live(result.markup);
    // Bootstrap's own requirements, which are exactly what gets forgotten
    // when this markup is written by hand
    expect(markup).toContain('role="group"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="breadcrumb"');
    expect(markup).toContain('class="visually-hidden"');
  });

  it('renders each list-driven component once per entry', () => {
    const markup = live(result.markup);
    // the showcase drives the badges and buttons from the same eight-variant
    // array, so the count is the check that replication actually ran
    for (const variant of ['primary', 'secondary', 'success', 'danger']) {
      expect(markup).toContain(`text-bg-${variant}`);
      expect(markup).toContain(`btn-${variant}`);
    }
    expect(markup).toContain('btn-outline-danger');
  });

  it('leaves the stencils unbound', () => {
    // a `:for-each` host is a template, never a rendering: anything data-like
    // in there means the host evaluated values that belong to its clones
    const stencils = [...result.markup.matchAll(/<template>([\s\S]*?)<\/template>/g)]
      .map(m => m[1])
      .join('\n');
    expect(stencils).not.toContain('Ada Lovelace');
    expect(stencils).not.toContain('Tooltip on top');
  });
});

/**
 * The demo application, which tests what the showcase can't.
 *
 * The showcase is a catalogue: each component on its own, next to the last.
 * `orbit.html` is one page built OUT of them, and every bug it turned up
 * while it was being written lived where two features meet rather than in
 * either one -- a slot filled with a `:for-each`, a slot fallback holding a
 * component, a derived value reading another derived value, a replica
 * looking for its host. None of those shapes occur in the showcase.
 *
 * So this block is not a second copy of the one above. It pins the page's
 * own invariants, and the live half below drives the interactions that are
 * pure markout -- filtering, sorting, paging -- which need no Bootstrap at
 * all and are exactly where a propagation bug shows up as stale content and
 * nothing else.
 */
describe('the demo application: served from its data files', () => {
  // Orbit is the round trip end to end: its data is fetched while rendering,
  // arrives in the markup, and the fetching itself stays behind.
  it('renders rows its data files answered with', async () => {
    const { markup } = await compile(SITE_ROOT, '/demos/orbit.html');
    expect(markup).toContain('edge-router');
    expect(markup).toContain('auth-service');
    expect(markup).toContain('d-2481');
  });

  it('joins two sources with an expression, not a second question', async () => {
    // which incidents matter is decided by which services are unwell. A
    // served API answered that with a query that could not be asked until
    // `services` had replied; over files it is a `.filter` in orbit.html
    // across two arrays that arrived together, and the page is the same
    const { markup } = await compile(SITE_ROOT, '/demos/orbit.html');
    expect(markup).toContain('billing unreachable in eu-west');
    expect(markup).toContain('auth-service latency above budget');
  });

  it('leaves no source element behind', async () => {
    // `std-data` is defined on `:logic`, so its instances are scopes and
    // nothing more -- ten of them at the top of this page and not one tag in
    // what is served
    const { markup } = await compile(SITE_ROOT, '/demos/orbit.html');
    expect(live(markup)).not.toContain('<std-data');
  });

  it('takes its API base from the fragment, and lets a page move it', async () => {
    // a fragment's root attributes land on whatever contains the include,
    // unless that element already declares them -- so `:apiBase` in
    // orbit/sources.htm is a default and the call site overrides it. The
    // same mechanism as the kit's URL tokens; nothing about it is a library
    // privilege, which is the point worth having a test for
    const docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-base-'));
    fs.cpSync(path.join(SITE_ROOT, 'demos/orbit'), path.join(docroot, 'demos/orbit'), { recursive: true });
    // vendored rather than installed: `/npm/` is resolved against the
    // filesystem from the DOCROOT upwards, and nothing above a temp
    // directory has a node_modules. A kit copied into the docroot is
    // imported by its path, which is the other half of the same design
    fs.cpSync(STD_KIT_DIR, path.join(docroot, 'std-kit'), {
      recursive: true,
      dereference: true,
    });
    fs.writeFileSync(
      path.join(docroot, 'moved.html'),
      '<html><head><:import src="/std-kit/all.htm" /></head>' +
        '<body :apiBase="https://elsewhere.test/v2">' +
        '<:include src="/demos/orbit/sources.htm" />${servicesSrc.data}</body></html>'
    );
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock;
    const before = calls.calls.length;
    const { errors } = await compile(docroot, '/moved.html');
    expect(errors).toStrictEqual([]);
    const asked = calls.calls.slice(before).map(c => `${c[0]}`);
    expect(asked).toContain('https://elsewhere.test/v2/services.json');
    expect(asked.every(u => u.startsWith('https://elsewhere.test/v2/'))).toBe(true);
    fs.rmSync(docroot, { recursive: true, force: true });
  });

  it('asks for every file, once, and only while rendering', async () => {
    // one request per source and not one more -- in particular the browser
    // is left with nothing to fetch, which is the whole claim
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock;
    const before = calls.calls.length;
    await compile(SITE_ROOT, '/demos/orbit.html');
    const asked = calls.calls.slice(before).map(c => new URL(`${c[0]}`));
    const paths = asked.map(u => u.pathname);
    expect(paths).toContain('/demos/orbit/api/services.json');
    expect(paths).toContain('/demos/orbit/api/incidents.json');
    expect(new Set(paths).size).toBe(paths.length);
    // and nothing it asks for is a question a file cannot be
    expect(asked.every(u => !u.search)).toBe(true);
  });
});

describe('the demo application', () => {
  let result: Awaited<ReturnType<typeof compile>>;

  beforeAll(async () => {
    result = await compile(SITE_ROOT, '/demos/orbit.html');
  });

  it('compiles and renders with nothing reported', () => {
    expect(result.errors).toStrictEqual([]);
    // a page-level `<:define>` whose slot sits under a scope used to leave
    // every replica in the markup filling it unbound, and each one was
    // reported here rather than thrown
    expect(result.runtime).toStrictEqual([]);
  });

  it('instantiates the kit\'s tags and its own', () => {
    // `dash-` are the four this page defines on top of the kit; either
    // prefix surviving is a usage the compiler didn't match to a definition
    const leftovers = [...live(result.markup).matchAll(/<((?:bs|dash)-[a-z-]+)/g)].map(m => m[1]);
    expect([...new Set(leftovers)]).toStrictEqual([]);
  });

  it('gives every element a unique id', () => {
    const ids = attrValues(live(result.markup), 'id');
    expect(ids.length).toBeGreaterThan(10);
    expect([...new Set(ids)]).toHaveLength(ids.length);
  });

  it.each([
    ['aria-controls', (v: string) => v],
    ['aria-labelledby', (v: string) => v],
    ['aria-describedby', (v: string) => v],
    ['for', (v: string) => v],
    ['data-bs-target', (v: string) => (v.startsWith('#') ? v.slice(1) : '')],
  ])('resolves every %s to an element that exists', (attr, toId) => {
    const markup = live(result.markup);
    const ids = new Set(attrValues(markup, 'id'));
    const refs = attrValues(markup, attr).map(toId).filter(id => id);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter(id => !ids.has(id))).toStrictEqual([]);
  });

  it('serves one page of rows, not the whole array', () => {
    // the row list is an expression over a search box, two selects, a sort
    // order and a page number. That it comes out sliced in the SERVED
    // markup is the whole isomorphic claim: the same expressions ran on the
    // server that will run in the browser
    const body = live(result.markup);
    const rows = [...body.matchAll(/<tr [^>]*data-markout="[^"]*-\d+"/g)];
    expect(rows.length).toBeGreaterThan(0);
    expect(body).toContain('Showing');
    // six deployments per page, six services, five endpoints, three regions
    expect(body).toContain('of 18');
  });

  it('points every in-page link at something that exists', () => {
    // the other half of the id wiring, and the half nothing checked: a nav
    // resolves its own `data-bs-target`, and its LINKS are what scrollspy
    // matches against the sections. The sidebar spent a while marking
    // "Overview" active by hand with nothing spying at all, which looks
    // exactly like a working nav until you scroll
    const markup = live(result.markup);
    const ids = new Set(attrValues(markup, 'id'));
    const hrefs = [...markup.matchAll(/\shref="(#[^"]+)"/g)].map(m => m[1]);
    expect(hrefs.length).toBeGreaterThan(10);
    expect([...new Set(hrefs)].filter(h => !ids.has(h.slice(1)))).toStrictEqual([]);
  });

  it('spies the page from <body> and the runbook from its own region', () => {
    const markup = live(result.markup);
    // the page's own scrolling element is <body>, so that is where the
    // attributes go; `bs-scrollspy` is for a region that scrolls inside it
    expect(markup).toMatch(/<body[^>]*data-bs-spy="scroll"[^>]*>/);
    expect(markup).toContain('data-bs-target="#dash-side-nav"');
    // and the region one, which sets its own height and overflow
    expect(markup).toMatch(/<div[^>]*data-bs-spy="scroll"[^>]*data-bs-target="#dash-runbook-nav"/);
  });

  it('draws the chart marker as stroke rather than as a shape', () => {
    // the plot box is stretched to fill its element, and x and y stretch by
    // different amounts -- so a <circle> renders as an ellipse, wider the
    // wider the chart. `vector-effect="non-scaling-stroke"` rescues a line's
    // width but not a shape's geometry. A zero-length path with a round cap
    // is a dot sized by stroke-width, which that same effect then keeps in
    // device pixels, so it stays round at any aspect ratio
    const markup = live(result.markup);
    expect(markup).toContain('stroke-linecap="round"');
    expect(markup).not.toContain('<circle');
  });

  it('keeps its prose out of the served page', () => {
    // this page carries more explanation than markup, and a comment written
    // `<!--` is markup: it would all be shipped. `<!---` is removed by the
    // preprocessor, and the runtime's own markers are the only comments
    // that should survive
    expect(result.markup).not.toMatch(/<!--(?!-)/);
  });

  it('writes an attribute name the way the page spelled it', () => {
    // the charts derive their `viewBox` from whether the chart is tall, and
    // an attribute set from an expression used to be dash-cased on its way
    // to the DOM -- `view-box`, which an SVG ignores, so every chart drew at
    // one pixel per unit in a corner and nothing said why
    expect(result.markup).toContain('viewBox=');
    expect(result.markup).not.toContain('view-box');
  });

  it('leaves the stencils unbound', () => {
    const stencils = [...result.markup.matchAll(/<template>([\s\S]*?)<\/template>/g)]
      .map(m => m[1])
      .join('\n');
    expect(stencils).not.toContain('edge-router');
    expect(stencils).not.toContain('eu-west');
  });
});

describe('a page that self-hosts Bootstrap', () => {
  // the URLs are tokens, so a page under a strict CSP can point them at its
  // own files and drop the hashes. Worth pinning: it is the one part of
  // base.htm a page is expected to override
  let docroot: string;

  beforeAll(() => {
    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-kit-'));
    fs.cpSync(KIT_DIR, path.join(docroot, 'bootstrap-kit'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(docroot, 'selfhosted.html'),
      `<html><head :const-bsCssUrl="/vendor/bootstrap.css"
                   :const-bsJsUrl="/vendor/bootstrap.js"
                   :const-bsCssIntegrity=\${null}
                   :const-bsJsIntegrity=\${null}>` +
        `<:import src="/bootstrap-kit/all.htm" /><title>t</title></head>` +
        `<body><bs-button>Go</bs-button></body></html>`
    );
  });

  afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

  it('takes the URLs and drops the hashes', async () => {
    const { errors, runtime, markup } = await compile(docroot, '/selfhosted.html');
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    // the served <head>, not the compiled props below it, which name every
    // attribute the definition can set whether or not it is set here
    const head = markup.slice(markup.indexOf('<head'), markup.indexOf('</head>'));
    expect(head).toContain('href="/vendor/bootstrap.css"');
    expect(head).toContain('src="/vendor/bootstrap.js"');
    // `crossorigin` follows the hash, and means nothing without one
    expect(head).not.toContain('integrity=');
    expect(head).not.toContain('crossorigin=');
    expect(markup).toContain('class="btn btn-primary"');
  });
});


/**
 * The half of the kit that markup can't show: what the components DO once
 * the page is live.
 *
 * The value-driven components are the point -- `:value` and `:open` are read
 * and written, so a page names an instance and uses it like any other value.
 * Rendering proves the markup; only running proves that.
 *
 * A real browser rather than happy-dom, which is what demo/setlist uses. That
 * demo depends on nothing but markout; this page pulls in a component library
 * with its own stylesheet and bundle, and happy-dom does not get through
 * loading it. Playwright is already here for that reason.
 *
 * Bootstrap's own JS is stubbed rather than fetched, which is what the URL
 * tokens make possible: the tests stay offline, and what belongs to this kit
 * is the CALL -- `Modal.getOrCreateInstance(el).show()` when `:open` becomes
 * true -- rather than what Bootstrap then does with it.
 */
const CHROMIUM = (() => {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

describe.skipIf(!CHROMIUM)('the components at work', () => {
  let docroot: string;
  let server: import('http').Server;
  let port = 0;
  let browser: Browser;

  const STUB = `
    window.__bsCalls = [];
    const record = (plugin, method, el) =>
      window.__bsCalls.push(plugin + '.' + method + ':' + (el.id || el.tagName));
    function make(name) {
      return class Plugin {
        constructor(el) { this.el = el; el.__p = this; record(name, 'new', el); }
        show() { record(name, 'show', this.el); }
        hide() { record(name, 'hide', this.el); }
        dispose() { record(name, 'dispose', this.el); }
        static getOrCreateInstance(el) { return el.__p || new Plugin(el); }
        static getInstance(el) { return el.__p; }
      };
    }
    window.bootstrap = {
      Modal: make('Modal'), Offcanvas: make('Offcanvas'), Toast: make('Toast'),
      Tooltip: make('Tooltip'), Popover: make('Popover'),
    };
  `;

  const PAGE = `<html>
    <head :const-bsCssUrl="/vendor/bootstrap.css"
          :const-bsJsUrl="/vendor/bootstrap.js"
          :const-bsCssIntegrity=\${null}
          :const-bsJsIntegrity=\${null}>
      <:import src="/bootstrap-kit/all.htm" />
      <title>at work</title>
    </head>
    <body :page=\${1}>
      <bs-input :aka="email" ::label="Email" ::check=\${(v) => v.includes('@')} />
      <bs-check :aka="terms" ::label="Agree" />
      <bs-range :aka="amount" ::label="Amount" ::value=\${10} />
      <p id="echo">\${email.value}|\${terms.checked}|\${amount.value}</p>

      <button id="submit" :attr-disabled=\${!email.valid}>submit</button>

      <bs-pagination ::current=\${page} ::pages=\${3} ::select=\${(n) => page = n} />
      <p id="paged">page \${page}</p>

      <bs-table ::columns=\${[{ key: 'n', name: 'N' }]}
                ::rows=\${[{ n: page }, { n: page * 2 }]} />

      <bs-modal :aka="dialog" ::name="dlg" ::title="Hi">body</bs-modal>
      <button id="open" :on-click=\${() => dialog.open = true}>open</button>
    </body>
  </html>`;

  beforeAll(async () => {
    // the browser runs the BUILT runtime, not src -- a stale bundle is a
    // test that silently checks the previous commit
    execSync('npm run build:runtime', { cwd: path.resolve(__dirname, '../../../core') });

    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-kit-live-'));
    // INSTALLED into the temp docroot rather than copied beside its pages:
    // orbit.html imports both kits through `/npm/`, which is resolved from
    // the docroot upwards against the filesystem, and nothing above a temp
    // directory has a node_modules. Copying them here is what makes the
    // copy self-contained -- and it is also what a real install looks like,
    // so the page under test is the served one, unedited
    const modules = path.join(docroot, 'node_modules/@markout-lang');
    fs.mkdirSync(modules, { recursive: true });
    fs.cpSync(KIT_DIR, path.join(modules, 'bootstrap-kit'), { recursive: true });
    fs.cpSync(STD_KIT_DIR, path.join(modules, 'std-kit'), {
      recursive: true,
      dereference: true,
    });
    // Orbit's own parts: its components and its datasources
    fs.cpSync(path.join(SITE_ROOT, 'demos/orbit'), path.join(docroot, 'demos/orbit'), { recursive: true });
    fs.mkdirSync(path.join(docroot, 'vendor'));
    fs.writeFileSync(path.join(docroot, 'vendor/bootstrap.js'), STUB);
    fs.writeFileSync(path.join(docroot, 'vendor/bootstrap.css'), '');
    fs.writeFileSync(path.join(docroot, 'index.html'), PAGE);
    // the site's analytics tag, stubbed like the CDN above it: the include
    // has to RESOLVE for the page to compile, and the tag it carries would
    // have a headless browser fetch a tracker over the network and register a
    // visit nobody paid. Empty rather than absent, so that this suite says
    // nothing about whether the site is tracked
    fs.mkdirSync(path.join(docroot, 'parts'));
    fs.writeFileSync(path.join(docroot, 'parts/analytics.htm'), '<lib></lib>\n');

    // the real demo, pointed at the stub. The URL tokens are what makes
    // that possible without forking the page: it imports the kit exactly as
    // it does when served, and only where Bootstrap comes from changes
    const demo = fs.readFileSync(path.join(SITE_ROOT, 'demos/orbit.html'), 'utf8');
    const offline = demo.replace(
      '<head>',
      '<head :const-bsCssUrl="/vendor/bootstrap.css"\n' +
        '      :const-bsJsUrl="/vendor/bootstrap.js"\n' +
        '      :const-bsCssIntegrity=${null}\n' +
        '      :const-bsJsIntegrity=${null}>'
    );
    if (offline === demo) {
      // a silent no-op here would put the CDN back in the test run
      throw new Error('orbit.html: no bare <head> to point at the stub');
    }
    fs.writeFileSync(path.join(docroot, 'orbit.html'), offline);

    // the site's OWN app, so the browser is served by the same stack the dev
    // server runs rather than a second copy of it
    server = createSite({ docroot }).listen(0);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    port = (server.address() as import('net').AddressInfo).port;
    browser = await chromium.launch();
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>(resolve => server?.close(() => resolve()));
    fs.rmSync(docroot, { recursive: true, force: true });
  });

  /** a freshly hydrated page, plus everything the assertions need from it */
  async function open(pathname = '/index.html') {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on('pageerror', e => failures.push(`pageerror: ${e.message}`));
    page.on('console', m => m.type() === 'error' && failures.push(m.text()));
    await page.goto(`http://127.0.0.1:${port}${pathname}`);
    await page.waitForFunction('window.__MARKOUT_PROPS !== undefined');
    return {
      page,
      failures,
      text: (sel: string) => page.locator(sel).innerText(),
      calls: () => page.evaluate('window.__bsCalls') as Promise<string[]>,
    };
  }

  it('hydrates without reporting anything', async () => {
    const { page, failures } = await open();
    try {
      // the dev-mode error panel, which the server only paints when the
      // runtime reported something
      expect(await page.locator('#markout-errors').count()).toBe(0);
      expect(failures).toStrictEqual([]);
      expect(await page.locator('bs-input').count()).toBe(0);
      expect(await page.locator('input.form-control').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it("reads a control's value from elsewhere on the page", async () => {
    const { page, text, failures } = await open();
    try {
      expect(await text('#echo')).toBe('|false|10');

      await page.fill('input.form-control', 'a@b.c');
      await page.locator('.form-check-input').check();
      expect(await text('#echo')).toBe('a@b.c|true|10');
      expect(failures).toStrictEqual([]);
    } finally {
      await page.close();
    }
  });

  it('marks a control invalid by its own rule, not by being touched', async () => {
    const { page } = await open();
    try {
      const input = page.locator('input.form-control');
      // empty is neutral, so a form doesn't open covered in errors
      expect(await input.getAttribute('class')).not.toContain('is-invalid');

      await input.fill('nope');
      expect(await input.getAttribute('class')).toContain('is-invalid');

      await input.fill('yes@please');
      expect(await input.getAttribute('class')).not.toContain('is-invalid');
    } finally {
      await page.close();
    }
  });

  it('answers whether a control holds something to submit, not whether it is red', async () => {
    const { page } = await open();
    try {
      const input = page.locator('input.form-control');
      const submit = page.locator('#submit');
      // empty: nothing wrong with it, and nothing in it either -- the two
      // questions the component deliberately answers differently
      expect(await input.getAttribute('class')).not.toContain('is-invalid');
      expect(await submit.isDisabled()).toBe(true);

      await input.fill('nope');
      expect(await submit.isDisabled()).toBe(true);

      await input.fill('yes@please');
      expect(await submit.isDisabled()).toBe(false);

      // and back, since this is a value like any other rather than a state
      // something has to remember to clear
      await input.fill('');
      expect(await submit.isDisabled()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('calls back with a page number, and redraws whatever reads it', async () => {
    const { page, text } = await open();
    try {
      expect(await text('#paged')).toBe('page 1');
      expect(await page.locator('tbody td').allInnerTexts()).toStrictEqual(['1', '2']);

      // the links are prev, 1, 2, 3, next
      await page.locator('.page-link').nth(3).click();

      expect(await text('#paged')).toBe('page 3');
      expect((await page.locator('.page-item.active').innerText()).trim()).toBe('3');
      // the table's rows are an expression over that same value
      expect(await page.locator('tbody td').allInnerTexts()).toStrictEqual(['3', '6']);
    } finally {
      await page.close();
    }
  });

  it('drives a plugin from a value rather than from a click', async () => {
    const { page, calls } = await open();
    try {
      // `:handle-open` ran once at start with false, so the instance exists
      // and is hidden; what matters is that setting the value shows it
      expect(await calls()).not.toContain('Modal.show:dlg');

      await page.locator('#open').click();
      expect(await calls()).toContain('Modal.show:dlg');
    } finally {
      await page.close();
    }
  });

  /**
   * The demo application, driven.
   *
   * Everything below is pure markout -- a filter, a sort, a page number, a
   * checkbox, a colour -- so none of it needs Bootstrap's JS, and none of it
   * reports anything when it goes wrong. A propagation bug here shows up as
   * content that is one step behind and nothing else, which is why these
   * assertions compare what is on screen rather than counting calls.
   */
  describe('the demo application: served from its data files', () => {
  // Orbit is the round trip end to end: its data is fetched while rendering,
  // arrives in the markup, and the fetching itself stays behind.
  it('renders rows its data files answered with', async () => {
    const { markup } = await compile(SITE_ROOT, '/demos/orbit.html');
    expect(markup).toContain('edge-router');
    expect(markup).toContain('auth-service');
    expect(markup).toContain('d-2481');
  });

  it('joins two sources with an expression, not a second question', async () => {
    // which incidents matter is decided by which services are unwell. A
    // served API answered that with a query that could not be asked until
    // `services` had replied; over files it is a `.filter` in orbit.html
    // across two arrays that arrived together, and the page is the same
    const { markup } = await compile(SITE_ROOT, '/demos/orbit.html');
    expect(markup).toContain('billing unreachable in eu-west');
    expect(markup).toContain('auth-service latency above budget');
  });

  it('leaves no source element behind', async () => {
    // `std-data` is defined on `:logic`, so its instances are scopes and
    // nothing more -- ten of them at the top of this page and not one tag in
    // what is served
    const { markup } = await compile(SITE_ROOT, '/demos/orbit.html');
    expect(live(markup)).not.toContain('<std-data');
  });

  it('takes its API base from the fragment, and lets a page move it', async () => {
    // a fragment's root attributes land on whatever contains the include,
    // unless that element already declares them -- so `:apiBase` in
    // orbit/sources.htm is a default and the call site overrides it. The
    // same mechanism as the kit's URL tokens; nothing about it is a library
    // privilege, which is the point worth having a test for
    const docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-base-'));
    fs.cpSync(path.join(SITE_ROOT, 'demos/orbit'), path.join(docroot, 'demos/orbit'), { recursive: true });
    // vendored rather than installed: `/npm/` is resolved against the
    // filesystem from the DOCROOT upwards, and nothing above a temp
    // directory has a node_modules. A kit copied into the docroot is
    // imported by its path, which is the other half of the same design
    fs.cpSync(STD_KIT_DIR, path.join(docroot, 'std-kit'), {
      recursive: true,
      dereference: true,
    });
    fs.writeFileSync(
      path.join(docroot, 'moved.html'),
      '<html><head><:import src="/std-kit/all.htm" /></head>' +
        '<body :apiBase="https://elsewhere.test/v2">' +
        '<:include src="/demos/orbit/sources.htm" />${servicesSrc.data}</body></html>'
    );
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock;
    const before = calls.calls.length;
    const { errors } = await compile(docroot, '/moved.html');
    expect(errors).toStrictEqual([]);
    const asked = calls.calls.slice(before).map(c => `${c[0]}`);
    expect(asked).toContain('https://elsewhere.test/v2/services.json');
    expect(asked.every(u => u.startsWith('https://elsewhere.test/v2/'))).toBe(true);
    fs.rmSync(docroot, { recursive: true, force: true });
  });

  it('asks for every file, once, and only while rendering', async () => {
    // one request per source and not one more -- in particular the browser
    // is left with nothing to fetch, which is the whole claim
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock;
    const before = calls.calls.length;
    await compile(SITE_ROOT, '/demos/orbit.html');
    const asked = calls.calls.slice(before).map(c => new URL(`${c[0]}`));
    const paths = asked.map(u => u.pathname);
    expect(paths).toContain('/demos/orbit/api/services.json');
    expect(paths).toContain('/demos/orbit/api/incidents.json');
    expect(new Set(paths).size).toBe(paths.length);
    // and nothing it asks for is a question a file cannot be
    expect(asked.every(u => !u.search)).toBe(true);
  });
});

describe('the demo application', () => {
    const rows = '#deployments tbody tr';
    const services = '#deployments tbody td.fw-semibold';
    const commits = '#deployments td.dash-mono';

    it('hydrates without reporting anything', async () => {
      const { page, failures } = await open('/orbit.html');
      try {
        expect(await page.locator('#markout-errors').count()).toBe(0);
        expect(failures).toStrictEqual([]);
        // the page's own tags as well as the kit's
        expect(await page.locator('dash-panel, dash-chart, bs-card').count()).toBe(0);
        expect(await page.locator(rows).count()).toBe(6);
      } finally {
        await page.close();
      }
    });

    it('filters a table nothing is listening to', async () => {
      const { page, failures } = await open('/orbit.html');
      try {
        await page.locator('#deployments input[type="text"]').fill('auth');

        expect(await page.locator(services).allInnerTexts())
          .toStrictEqual(Array(3).fill('auth-service'));
        // the count under the table reads the same expression the rows do
        expect(await page.locator('#deployments').innerText()).toContain('Showing 3 of 3');
        expect(failures).toStrictEqual([]);
      } finally {
        await page.close();
      }
    });

    it('sorts by whichever column was asked for', async () => {
      const { page } = await open('/orbit.html');
      try {
        // the headers are buttons calling one function that flips two
        // values; the row order is an expression over them
        await page.locator('#deployments thead button').first().click();
        const asc = await page.locator(services).allInnerTexts();
        expect(asc).toStrictEqual([...asc].sort());

        await page.locator('#deployments thead button').first().click();
        const desc = await page.locator(services).allInnerTexts();
        expect(desc).toStrictEqual([...desc].sort().reverse());
      } finally {
        await page.close();
      }
    });

    it('shows the page it says it is showing', async () => {
      const { page } = await open('/orbit.html');
      try {
        const first = await page.locator(commits).allInnerTexts();
        expect(first).toHaveLength(6);

        await page.locator('#deployments .page-link').nth(2).click();

        // the regression this pins: the slice used to be a step behind the
        // page number, so the pagination said 2 while the table still held
        // page 1 -- no error anywhere, just the wrong rows
        expect((await page.locator('#deployments .page-item.active').innerText()).trim())
          .toBe('2');
        const second = await page.locator(commits).allInnerTexts();
        expect(second).toHaveLength(6);
        expect(second.filter(c => first.includes(c))).toStrictEqual([]);
      } finally {
        await page.close();
      }
    });

    it('writes back into the array a checkbox came from', async () => {
      const { page } = await open('/orbit.html');
      try {
        expect(await page.locator('#activity').innerText()).toContain('2/5 done');

        await page.locator('#activity .form-check-input').first().check();

        // the counter, the bar and the strikethrough all read `todos`
        expect(await page.locator('#activity').innerText()).toContain('3/5 done');
        expect(await page.locator('#activity .progress-bar').getAttribute('style'))
          .toContain('60%');
      } finally {
        await page.close();
      }
    });

    it('restyles the page from one value', async () => {
      const { page } = await open('/orbit.html');
      try {
        // the stylesheet interpolates `accent`; nothing toggles a class
        const swatch = page.locator('#settings .dash-swatch').nth(2);
        await swatch.click();

        // as a string, like the plugin-call assertions above: this file is
        // typechecked without the DOM lib, since it is mostly compiler work
        expect(
          await page.evaluate(
            "getComputedStyle(document.documentElement)" +
              ".getPropertyValue('--dash-accent').trim()"
          )
        ).toBe('#20c997');
      } finally {
        await page.close();
      }
    });

    /**
     * The one place in the demo where a control's state and a sentence about
     * it have to agree.
     *
     * `bs-check-group` reported ONE value whatever its `:type`, so a
     * checkbox group behaved as a radio group that could not make up its
     * mind: ticking a second box unticked the first, unticking a box left it
     * ticked, and the summary named a single channel however many were on
     * screen. Nothing but clicking finds that, which is why this is here
     * rather than beside the compiler tests.
     */
    it('reflects the notification checkboxes in the sentence beneath them', async () => {
      const { page, failures } = await open('/orbit.html');
      try {
        const box = (name: string) =>
          page.locator(`#settings input[type="checkbox"][value="${name}"]`);
        const says = async () =>
          (await page.locator('#settings').innerText()).replace(/\s+/g, ' ');

        expect(await says()).toContain('over Slack when');

        await box('Email').check();
        // in the order the options were given, not the order they were clicked
        expect(await says()).toContain('over Email, Slack when');

        await box('SMS').check();
        expect(await says()).toContain('over Email, Slack, SMS when');

        await box('Slack').uncheck();
        expect(await says()).toContain('over Email, SMS when');
        // and the others were left alone, which is the half that was broken
        expect(await box('Email').isChecked()).toBe(true);
        expect(await box('SMS').isChecked()).toBe(true);

        await box('Email').uncheck();
        await box('SMS').uncheck();
        expect(await says()).toContain('over no channel when');
        expect(failures).toStrictEqual([]);
      } finally {
        await page.close();
      }
    });
  });
});
