import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { Server } from '../../src/server';
import { renderPage } from '../../src/server/render';

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
 * Nothing here reaches the network. The kit's Bootstrap URLs are tokens, so
 * the tests point them at files that don't need fetching; what is being
 * tested is the markup markout produces, not what a CDN serves.
 */

const KIT_ROOT = path.resolve(__dirname, '../../kits/bootstrap');
const PARTS_DIR = path.join(KIT_ROOT, 'bootstrap-kit/parts');

async function compile(docroot: string, pathname: string) {
  const page = await new Compiler({ docroot }).compile(pathname);
  const errors = page.errors.map(e => e.msg);
  const runtime = errors.length ? [] : renderPage(page).map(e => `${e.phase}: ${e.message}`);
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
    fs.cpSync(path.join(KIT_ROOT, 'bootstrap-kit'), path.join(docroot, 'bootstrap-kit'), {
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

describe('the showcase', () => {
  let result: Awaited<ReturnType<typeof compile>>;

  beforeAll(async () => {
    // the real page, not a copy: it uses every component the kit defines,
    // which is what makes it worth compiling here
    result = await compile(KIT_ROOT, '/index.html');
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

describe('a page that self-hosts Bootstrap', () => {
  // the URLs are tokens, so a page under a strict CSP can point them at its
  // own files and drop the hashes. Worth pinning: it is the one part of
  // base.htm a page is expected to override
  let docroot: string;

  beforeAll(() => {
    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-kit-'));
    fs.cpSync(path.join(KIT_ROOT, 'bootstrap-kit'), path.join(docroot, 'bootstrap-kit'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(docroot, 'selfhosted.html'),
      `<html><head :k_bsCssUrl="/vendor/bootstrap.css"
                   :k_bsJsUrl="/vendor/bootstrap.js"
                   :k_bsCssIntegrity=\${null}
                   :k_bsJsIntegrity=\${null}>` +
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
  let server: Server;
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
    <head :k_bsCssUrl="/vendor/bootstrap.css"
          :k_bsJsUrl="/vendor/bootstrap.js"
          :k_bsCssIntegrity=\${null}
          :k_bsJsIntegrity=\${null}>
      <:import src="/bootstrap-kit/all.htm" />
      <title>at work</title>
    </head>
    <body :page=\${1}>
      <bs-input :aka="email" :label="Email" :check=\${(v) => v.includes('@')} />
      <bs-check :aka="terms" :label="Agree" />
      <bs-range :aka="amount" :label="Amount" :value=\${10} />
      <p id="echo">\${email.value}|\${terms.checked}|\${amount.value}</p>

      <bs-pagination :current=\${page} :pages=\${3} :select=\${(n) => page = n} />
      <p id="paged">page \${page}</p>

      <bs-table :columns=\${[{ key: 'n', name: 'N' }]}
                :rows=\${[{ n: page }, { n: page * 2 }]} />

      <bs-modal :aka="dialog" :name="dlg" :title="Hi">body</bs-modal>
      <button id="open" :on-click=\${() => dialog.open = true}>open</button>
    </body>
  </html>`;

  beforeAll(async () => {
    // the browser runs the BUILT runtime, not src -- a stale bundle is a
    // test that silently checks the previous commit
    execSync('npm run build:runtime', { cwd: path.resolve(__dirname, '../..') });

    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-kit-live-'));
    fs.cpSync(path.join(KIT_ROOT, 'bootstrap-kit'), path.join(docroot, 'bootstrap-kit'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(docroot, 'vendor'));
    fs.writeFileSync(path.join(docroot, 'vendor/bootstrap.js'), STUB);
    fs.writeFileSync(path.join(docroot, 'vendor/bootstrap.css'), '');
    fs.writeFileSync(path.join(docroot, 'index.html'), PAGE);

    server = await new Server({ docroot, port: 0, logger: () => {} }).start();
    browser = await chromium.launch();
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    await server?.stop();
    fs.rmSync(docroot, { recursive: true, force: true });
  });

  /** a freshly hydrated page, plus everything the assertions need from it */
  async function open() {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on('pageerror', e => failures.push(`pageerror: ${e.message}`));
    page.on('console', m => m.type() === 'error' && failures.push(m.text()));
    await page.goto(`http://127.0.0.1:${server.port}/index.html`);
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
});
