import { execSync } from "child_process";
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser } from "happy-dom";
import { Server } from "../../src/server";
import fs from "fs";
import os from "os";

describe("Browser execution (happy-dom)", () => {
  let tempDir: string;
  let server: Server;

  beforeAll(async () => {
    // guarantee a fresh dist/markout-runtime.js regardless of local state
    execSync('npm run build:runtime', { cwd: path.resolve(__dirname, '../..') });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-e2e-test-"));
    fs.writeFileSync(
      path.join(tempDir, "counter.html"),
      `<html :count=\${0}>
        <body>
          <button :on-click=\${() => count++}>Clicked \${count} times</button>
        </body>
      </html>`
    );
    fs.writeFileSync(
      path.join(tempDir, "attributes.html"),
      `<html :count=\${0}>
        <body>
          <button :on-click=\${() => count++}
                  data-count=\${count}
                  aria-label=\${'clicked ' + count}
                  title=\${count > 0 ? 'yes' : null}
                  type="button">click</button>
        </body>
      </html>`
    );

    fs.writeFileSync(
      path.join(tempDir, "ids.htm"),
      // :_id anchors the id on the component root, so every descendant
      // referring to it gets the SAME one -- a bare ${$id} down there would
      // be that descendant's own scope id instead
      `<lib><:define tag="my-w:div" :_id=\${$id}>` +
        `<span data-id="w-\${_id}">w</span><span data-id="x-\${_id}">x</span>` +
        `</:define></lib>`
    );
    fs.writeFileSync(
      path.join(tempDir, "ids.html"),
      `<html :count=\${0} :items=\${[1, 2]}>
        <head><:import src="ids.htm" /></head>
        <body>
          <my-w /><my-w />
          <ul><li :for-each=\${items} data-id="i-\${$id}" id="i-\${$id}">\${data}</li></ul>
          <button :on-click=\${() => items = [...items, items.length + 1]}>grow</button>
        </body>
      </html>`
    );

    fs.writeFileSync(
      path.join(tempDir, "cards.htm"),
      `<lib><:define tag="my-card:div" class="card" :label="none" :_id=\${$id}>` +
        `<span data-card="\${label}" data-cid="\${_id}">\${label}</span>` +
        `</:define></lib>`
    );
    fs.writeFileSync(
      path.join(tempDir, "cards.html"),
      `<html :items=\${['a', 'b']}>
        <head><:import src="cards.htm" /></head>
        <body>
          <ul><li :for-each=\${items}><my-card :label=\${data} /></li></ul>
          <button :on-click=\${() => items = [...items, 'c']}>grow</button>
        </body>
      </html>`
    );

    fs.writeFileSync(
      path.join(tempDir, "slots.htm"),
      `<lib>` +
        `<:define tag="my-badge:span" class="badge" :label="B">\${label}</:define>` +
        `<:define tag="my-card:div" class="card"><:slot /></:define>` +
        `</lib>`
    );
    fs.writeFileSync(
      path.join(tempDir, "slots.html"),
      `<html :who=\${'world'}>
        <head><:import src="slots.htm" /></head>
        <body>
          <my-card><my-badge :label=\${who} /><b>\${who}</b></my-card>
          <button :on-click=\${() => who = 'again'}>go</button>
        </body>
      </html>`
    );

    fs.writeFileSync(
      path.join(tempDir, "filter.html"),
      `<html :sel=\${'all'} :items=\${[
        { name: 'peas', kind: 'spring' },
        { name: 'tomatoes', kind: 'summer' },
        { name: 'mushrooms', kind: 'autumn' },
        { name: 'asparagus', kind: 'spring' },
      ]}>
        <body>
          <ul><li :for-each=\${items.filter(i => sel === 'all' || i.kind === sel)}>
            <span class="name">\${data.name}</span><span class="kind">\${data.kind}</span>
          </li></ul>
          <button id="narrow" :on-click=\${() => sel = 'spring'}>narrow</button>
          <button id="widen" :on-click=\${() => sel = 'all'}>widen</button>
        </body>
      </html>`
    );

    fs.writeFileSync(
      path.join(tempDir, "nullish.html"),
      `<html :note=\${null}>
        <body>
          <p id="note">\${note}</p>
          <button :on-click=\${() => note = 'now set'}>set</button>
        </body>
      </html>`
    );

    // the same rows rendered twice off one array: keyed on the left, plain on
    // the right. One button rotates the array, so a single click shows what
    // :for-key changes and what it leaves alone
    fs.writeFileSync(
      path.join(tempDir, "keyed.html"),
      `<html :rows=\${[{ id: 'a' }, { id: 'b' }, { id: 'c' }]}>
        <body>
          <ul id="keyed"><li :for-each=\${rows} :for-key=\${data.id} data-row=\${data.id}><input></li></ul>
          <ul id="plain"><li :for-each=\${rows} data-row=\${data.id}><input></li></ul>
          <button id="rotate" :on-click=\${() => rows = [rows[2], rows[0], rows[1]]}>rotate</button>
        </body>
      </html>`
    );

    server = new Server({ docroot: tempDir });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should hydrate and react to a real click, entirely inside a happy-dom window', async () => {
    // navigating for real exercises the actual <script async> loading and
    // execution pipeline, rather than manually eval-ing extracted source
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/counter.html`);
      await page.waitUntilComplete();

      const document = page.mainFrame.document;
      const button = document.querySelector('button')!;
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Clicked 0 times');

      button.dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Clicked 1 times');

      button.dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
      button.dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Clicked 3 times');
    } finally {
      await browser.close();
    }
  });

  it('should keep plain attributes with ${} values in sync with their expression', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/attributes.html`);
      await page.waitUntilComplete();

      const button = page.mainFrame.document.querySelector('button')!;
      // SSR already painted the initial values, so they're right before any
      // client-side refresh has had a chance to run
      expect(button.getAttribute('data-count')).toBe('0');
      expect(button.getAttribute('aria-label')).toBe('clicked 0');
      expect(button.getAttribute('type')).toBe('button');
      // a null value means "no attribute", not the string "null"
      expect(button.hasAttribute('title')).toBe(false);

      button.dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
      expect(button.getAttribute('data-count')).toBe('1');
      expect(button.getAttribute('aria-label')).toBe('clicked 1');
      expect(button.getAttribute('title')).toBe('yes');
      expect(button.getAttribute('type')).toBe('button');
    } finally {
      await browser.close();
    }
  });

  it('should give each $id instance a distinct, SSR-agreeing id', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/ids.html`);
      await page.waitUntilComplete();

      const read = () =>
        [...page.mainFrame.document.querySelectorAll('[data-id]')].map(e =>
          e.getAttribute('data-id')
        );
      const hydrated = read();

      // each usage instance gets its own id, and both spans within one
      // instance agree on it -- that's what makes aria-controls/for wiring work
      const w = hydrated.filter(v => v!.startsWith('w-'));
      const x = hydrated.filter(v => v!.startsWith('x-'));
      expect(new Set(w).size).toBe(2);
      expect(w.map(v => v!.slice(2))).toEqual(x.map(v => v!.slice(2)));

      // :for-each replicas each get their own too
      const items = hydrated.filter(v => v!.startsWith('i-'));
      expect(new Set(items).size).toBe(2);

      // and the result stays usable as an HTML id: pages feed $id straight
      // into aria-controls / data-bs-target / a label's `for`, all of which
      // are resolved with a selector. A replica id containing `#` would be
      // legal markup that no selector can ever match
      for (const id of items) {
        expect(page.mainFrame.document.querySelector(`#${id}`)).not.toBeNull();
      }

      // the id comes from the compiled props rather than being re-derived, so
      // the served markup must already carry exactly what hydration produces
      const served = await (await fetch(`http://127.0.0.1:${server.port}/ids.html`)).text();
      for (const id of hydrated) {
        expect(served).toContain(`data-id="${id}"`);
      }

      // growing the list client-side must not renumber what's already there
      const button = page.mainFrame.document.querySelector('button')!;
      button.dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
      const grown = read();
      expect(grown.slice(0, hydrated.length)).toEqual(hydrated);
      expect(new Set(grown).size).toBe(grown.length);
    } finally {
      await browser.close();
    }
  });

  it('should hydrate a component slotted into another, staying reactive', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/slots.html`);
      await page.waitUntilComplete();

      const doc = page.mainFrame.document;
      const card = doc.querySelector('.card')!;
      const badge = () => doc.querySelector('.badge')!.textContent?.trim();
      const bold = () => doc.querySelector('b')!.textContent?.trim();

      // the nested tag expanded, inside the outer instance's DOM
      expect(doc.querySelector('my-badge')).toBeNull();
      expect(card.querySelector('.badge')).not.toBeNull();
      // both read the page's `who`, through two levels of scoping
      expect(badge()).toBe('world');
      expect(bold()).toBe('world');

      // and the call-site binding stays live after hydration
      doc.querySelector('button')!.dispatchEvent(
        new page.mainFrame.window.MouseEvent('click')
      );
      expect(badge()).toBe('again');
      expect(bold()).toBe('again');
    } finally {
      await browser.close();
    }
  });

  it('should instantiate a component per :for-each replica, and on growth', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/cards.html`);
      await page.waitUntilComplete();

      const doc = page.mainFrame.document;
      const cards = () =>
        [...doc.querySelectorAll('[data-card]')].map(e => e.getAttribute('data-card'));
      const ids = () =>
        [...doc.querySelectorAll('[data-cid]')].map(e => e.getAttribute('data-cid'));

      // one instance per replica, each reading its own item: the usage-site
      // expression evaluates at the call site, inside the loop
      expect(cards()).toEqual(['a', 'b']);
      // and each instance's own $id is distinct, so ids it builds don't collide
      expect(new Set(ids()).size).toBe(2);
      expect(doc.querySelector('my-card')).toBeNull();

      // a replica added client-side gets an instance of its own too
      doc.querySelector('button')!.dispatchEvent(
        new page.mainFrame.window.MouseEvent('click')
      );
      expect(cards()).toEqual(['a', 'b', 'c']);
      expect(new Set(ids()).size).toBe(3);
    } finally {
      await browser.close();
    }
  });

  it('should keep text bound in replicas re-created after the list shrank', async () => {
    // the whole round trip matters here, which is why this is an end-to-end
    // test rather than a runtime one: a replica the list outgrew is stamped
    // out of the <template> stencil, and the stencil is never bound to data,
    // so its interpolations serialize to nothing at all. The markup the
    // browser parses back therefore has the two text markers side by side,
    // with no text node between them for the binding to attach to
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/filter.html`);
      await page.waitUntilComplete();

      const doc = page.mainFrame.document;
      const window = page.mainFrame.window;
      const read = (cls: string) =>
        [...doc.querySelectorAll(`.${cls}`)].map(e => e.textContent);
      const click = (id: string) =>
        doc.querySelector(`#${id}`)!.dispatchEvent(new window.MouseEvent('click'));

      const errors: string[] = [];
      window.console.error = (...args: unknown[]) => errors.push(args.join(' '));

      expect(read('name')).toEqual(['peas', 'tomatoes', 'mushrooms', 'asparagus']);

      click('narrow');
      expect(read('name')).toEqual(['peas', 'asparagus']);

      // every replica beyond the first two is a fresh clone of the stencil,
      // and each has to come back with its text, not blank
      click('widen');
      expect(read('name')).toEqual(['peas', 'tomatoes', 'mushrooms', 'asparagus']);
      expect(read('kind')).toEqual(['spring', 'summer', 'autumn', 'spring']);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('should keep a binding that server-rendered to nothing alive after hydration', async () => {
    // a nullish binding renders as nothing, so its text node serializes away
    // entirely and the markers arrive adjacent -- the same shape the stencil
    // has. This is the whole reason a nullish value used to be written as a
    // zero-width space; init() materializing the node is what replaces it
    const served = await (
      await fetch(`http://127.0.0.1:${server.port}/nullish.html`)
    ).text();
    expect(served).toContain('<!---t0--><!---/-->');

    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/nullish.html`);
      await page.waitUntilComplete();

      const doc = page.mainFrame.document;
      const note = doc.querySelector('#note')!;
      // no placeholder character left on the page for `.trim()` to keep
      expect(note.textContent).toBe('');

      doc.querySelector('button')!.dispatchEvent(
        new page.mainFrame.window.MouseEvent('click')
      );
      expect(note.textContent).toBe('now set');
    } finally {
      await browser.close();
    }
  });

  it('should move a keyed replica with its item, carrying DOM state along', async () => {
    // state the DOM owns and the framework never sees -- here a typed-in
    // value -- is the whole reason keyed replication exists. The unkeyed list
    // beside it is rendered from the same array by the same click, and is
    // what the keyed one is being measured against
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/keyed.html`);
      await page.waitUntilComplete();

      const doc = page.mainFrame.document;
      const rows = (list: string) => [...doc.querySelectorAll(`#${list} li`)];
      // happy-dom's own element types, not lib.dom's: this package compiles
      // without lib.dom on purpose (see tsconfig.dom.json)
      type Row = ReturnType<typeof rows>[number];
      const field = (li: Row) => li.querySelector('input')!;
      const order = (list: string) => rows(list).map(li => li.getAttribute('data-row'));
      const typed = (list: string) => rows(list).map(li => field(li).value);

      expect(order('keyed')).toEqual(['a', 'b', 'c']);
      expect(order('plain')).toEqual(['a', 'b', 'c']);

      // type into row b on both sides, and remember b's actual element
      const keyedB = rows('keyed')[1];
      field(keyedB).value = 'mine';
      field(rows('plain')[1]).value = 'mine';

      doc.querySelector('#rotate')!.dispatchEvent(
        new page.mainFrame.window.MouseEvent('click')
      );

      expect(order('keyed')).toEqual(['c', 'a', 'b']);
      expect(order('plain')).toEqual(['c', 'a', 'b']);

      // keyed: b's element was MOVED, so the typing is still b's
      expect(rows('keyed')[2]).toBe(keyedB);
      expect(typed('keyed')).toEqual(['', '', 'mine']);

      // plain: the element stayed in slot 1 and the data was rewritten over
      // it, so the typing now sits on the row showing item a
      expect(typed('plain')).toEqual(['', 'mine', '']);
    } finally {
      await browser.close();
    }
  });
});
