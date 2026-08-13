import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../src/compiler';
import type { RuntimeError } from '../src/runtime/core/core-context';
import { WebContext } from '../src/runtime/web/web-context';
import { renderPage } from '../src/server/render';

/**
 * Every directive the syntax reference lists does something observable.
 *
 * The tables in `docs/reference/syntax.md` are claims, and a row costs
 * nothing to write. `:for-key` sat there for a long time as a row alone --
 * loaded, validated, compiled, and ignored by the runtime -- and so do
 * `:did-init` and `:will-dispose` still. Nothing caught any of them, because
 * the suites check what the code does rather than what the docs promise.
 *
 * So the doc table is read here and used as a checklist. A row with no case
 * below fails, and so does a case for a row that no longer exists: the two
 * cannot drift apart in either direction. Rows the docs mark **not
 * implemented** must prove they DON'T work, which is what keeps the marking
 * honest once someone finally builds one.
 */

// ---------------------------------------------------------------------------
// the checklist, read from the docs
// ---------------------------------------------------------------------------

const SYNTAX_MD = path.resolve(__dirname, '../docs/reference/syntax.md');

/** `##` sections whose tables list directives; `###` subsections are prose */
const TABLE_SECTIONS = new Set([
  'Interpolation',
  'Values',
  'Replication',
  'Modules and components',
  'Runtime-supplied values',
]);

interface Row {
  /** the first cell, backticks stripped -- how a row is named below */
  syntax: string;
  meaning: string;
}

function documentedRows(): Row[] {
  const rows: Row[] = [];
  let section = '';
  let inSubsection = false;
  for (const line of fs.readFileSync(SYNTAX_MD, 'utf8').split('\n')) {
    const h3 = /^###\s+/.test(line);
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      section = h2[1].trim();
      inSubsection = false;
      continue;
    }
    if (h3) {
      inSubsection = true;
      continue;
    }
    if (!TABLE_SECTIONS.has(section) || inSubsection) continue;
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const syntax = cells[0].replace(/`/g, '').trim();
    if (!syntax || /^-+$/.test(syntax) || syntax === 'Syntax' || syntax === 'Name') continue;
    rows.push({ syntax, meaning: cells[1] });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let docroot: string;
let seq = 0;

/** compiles a page (plus any fragments it imports) and server-renders it */
async function build(page: string, files: Record<string, string> = {}) {
  const name = `d${seq++}.html`;
  for (const [file, code] of Object.entries(files)) {
    fs.writeFileSync(path.join(docroot, file), code);
  }
  fs.writeFileSync(path.join(docroot, name), page);
  const compiled = await new Compiler({ docroot }).compile(`/${name}`);
  return compiled;
}

interface Probe {
  /** the live body markup, ids and markers stripped */
  body: () => string;
  /** the root scope, for driving a change through */
  ctx: WebContext;
  doc: any;
}

/** compile, render, and hand back something to assert against */
async function run(page: string, files?: Record<string, string>): Promise<Probe> {
  const compiled = await build(page, files);
  expect(compiled.errors.map(e => e.msg)).toStrictEqual([]);
  const errors = renderPage(compiled);
  expect(errors).toStrictEqual([]);
  const ctx = new WebContext({
    root: new Function(`return (${compiled.propsString});`)(),
    doc: compiled.source.doc,
    onError: e => {
      throw new Error(`${e.phase}/${e.key}: ${e.message}`);
    },
  }).refresh();
  const body = () => {
    const markup = compiled.source.doc.toString();
    return markup
      .slice(markup.indexOf('<body'), markup.indexOf('<script'))
      .replace(/<!--.*?-->/g, '')
      .replace(/ data-markout="[^"]*"/g, '');
  };
  return { body, ctx, doc: compiled.source.doc };
}

/**
 * The same, in a real DOM. Only events need it: the server DOM's
 * addEventListener is a no-op, so a handler can be bound there and never be
 * shown to do anything.
 */
async function runInBrowser(page: string) {
  const compiled = await build(page);
  expect(compiled.errors.map(e => e.msg)).toStrictEqual([]);
  expect(renderPage(compiled)).toStrictEqual([]);
  const window = new Window();
  window.document.write(compiled.source.doc.toString());
  const errors: RuntimeError[] = [];
  new WebContext({
    root: new Function(`return (${compiled.propsString});`)(),
    doc: window.document as any,
    onError: e => errors.push(e),
  }).refresh();
  expect(errors).toStrictEqual([]);
  return { window, doc: window.document };
}

// ---------------------------------------------------------------------------
// one case per documented row
// ---------------------------------------------------------------------------

type Case =
  /** proves the directive does something, and that it stays reactive */
  | { works: () => Promise<void> }
  /** the docs say it isn't built: prove that, so the marking can't rot */
  | { unimplemented: () => Promise<void> };

const CASES: Record<string, Case> = {
  // -- Interpolation --------------------------------------------------------
  '${expr} in text': {
    works: async () => {
      const p = await run('<html :v=${"A"}><body><i>${v}</i></body></html>');
      expect(p.body()).toContain('<i>A</i>');
      p.ctx.root.proxy['v'] = 'B';
      expect(p.body()).toContain('<i>B</i>');
    },
  },
  '${expr} in CSS': {
    works: async () => {
      const p = await run(
        '<html :c=${"red"}><head><style>i{color:${c}}</style></head><body><i>x</i></body></html>'
      );
      const css = () => p.doc.toString();
      expect(css()).toContain('color:red');
      p.ctx.root.proxy['c'] = 'blue';
      expect(css()).toContain('color:blue');
    },
  },
  'attr=${expr}': {
    works: async () => {
      const p = await run('<html :v=${"A"}><body><i title=${v}>x</i></body></html>');
      expect(p.body()).toContain('title="A"');
      p.ctx.root.proxy['v'] = 'B';
      expect(p.body()).toContain('title="B"');
    },
  },

  // -- Values ---------------------------------------------------------------
  ':name=${expr}': {
    works: async () => {
      const p = await run('<html><body><i :n=${41 + 1}>${n}</i></body></html>');
      expect(p.body()).toContain('<i>42</i>');
    },
  },
  ':aka="name"': {
    works: async () => {
      const p = await run(
        '<html><body><div :aka="box" :n=${7}><i>${box.n}</i></div></body></html>'
      );
      expect(p.body()).toContain('<i>7</i>');
    },
  },
  ':attr-name=${expr}': {
    works: async () => {
      const p = await run('<html :on=${true}><body><i :attr-hidden=${on}>x</i></body></html>');
      expect(p.body()).toContain('hidden');
      p.ctx.root.proxy['on'] = false;
      expect(p.body()).not.toContain('hidden');
    },
  },
  ':prop-name=${expr}': {
    works: async () => {
      const p = await run('<html><body><i :prop-probeProp=${"A"}>x</i></body></html>');
      const el = (p.ctx.root.children[1] as any).children[0];
      expect(el.dom.probeProp).toBe('A');
      el.proxy['prop$probeProp'] = 'B';
      expect(el.dom.probeProp).toBe('B');
    },
  },
  ':class-name': {
    works: async () => {
      const p = await run('<html :on=${true}><body><i :class-lit=${on}>x</i></body></html>');
      expect(p.body()).toContain('class="lit"');
      p.ctx.root.proxy['on'] = false;
      expect(p.body()).not.toContain('lit');
    },
  },
  ':style-name': {
    works: async () => {
      const p = await run('<html :c=${"red"}><body><i :style-color=${c}>x</i></body></html>');
      expect(p.body()).toContain('color: red');
      p.ctx.root.proxy['c'] = 'blue';
      expect(p.body()).toContain('color: blue');
    },
  },
  ':on-click=${() => ...}': {
    works: async () => {
      // a real DOM: the server's addEventListener does nothing at all
      const { window, doc } = await runInBrowser(
        '<html :n=${0}><body><button :on-click=${() => n++}>go</button><i>${n}</i></body></html>'
      );
      const readout = () => doc.querySelector('i')!.textContent;
      expect(readout()).toBe('0');
      doc.querySelector('button')!.dispatchEvent(new window.MouseEvent('click'));
      expect(readout()).toBe('1');
    },
  },
  ':did-init=${() => ...}': {
    unimplemented: async () => {
      const g = globalThis as any;
      g.DOCS_DID = false;
      await run('<html><body><i :did-init=${() => { globalThis.DOCS_DID = true; }}>x</i></body></html>');
      expect(g.DOCS_DID).toBe(false);
    },
  },
  ':will-dispose=${() => ...}': {
    unimplemented: async () => {
      const g = globalThis as any;
      g.DOCS_WILL = false;
      const p = await run(
        '<html><body><i :will-dispose=${() => { globalThis.DOCS_WILL = true; }}>x</i></body></html>'
      );
      (p.ctx.root.children[1] as any).children[0].dispose();
      expect(g.DOCS_WILL).toBe(false);
    },
  },

  // -- Replication ----------------------------------------------------------
  ':for-each=${expr}': {
    works: async () => {
      const p = await run('<html><body><i :for-each=${["a", "b"]}>${data}</i></body></html>');
      const live = p.body().slice(p.body().indexOf('</template>'));
      expect(live.match(/<i>/g)?.length).toBe(2);
      expect(live).toContain('>a<');
      expect(live).toContain('>b<');
    },
  },
  ':for-as="name"': {
    works: async () => {
      const p = await run(
        '<html><body><i :for-each=${["a"]} :for-as="item">${item}</i></body></html>'
      );
      expect(p.body().slice(p.body().indexOf('</template>'))).toContain('>a<');
    },
  },
  ':for-key=${expr}': {
    works: async () => {
      // identity, not output: the same element has to MOVE when the list
      // reorders, which is the whole difference the row is claiming
      const p = await run(
        '<html :rows=${[{ id: "a" }, { id: "b" }]}><body>' +
          '<i :for-each=${rows} :for-key=${data.id} title=${data.id}>x</i></body></html>'
      );
      const host = (p.ctx.root.children[1] as any).children[0];
      const first = host.clones[0].dom;
      p.ctx.root.proxy['rows'] = [{ id: 'b' }, { id: 'a' }];
      expect(host.clones[1].dom).toBe(first);
      expect(host.clones[1].dom.getAttribute('title')).toBe('a');
    },
  },
  ':for-data=${expr}': {
    unimplemented: async () => {
      const compiled = await build('<html><body><i :for-data=${1}>x</i></body></html>');
      expect(compiled.errors.length).toBeGreaterThan(0);
    },
  },

  // -- Modules and components ----------------------------------------------
  '<:include src="file.htm" />': {
    works: async () => {
      const p = await run(
        '<html><body><:include src="inc.htm" /></body></html>',
        { 'inc.htm': '<lib><i>included</i></lib>' }
      );
      expect(p.body()).toContain('<i>included</i>');
    },
  },
  '<:include src="file.txt" as="pre" />': {
    works: async () => {
      const p = await run(
        '<html><body><:include src="raw.txt" as="pre" /></body></html>',
        { 'raw.txt': 'literal text' }
      );
      expect(p.body()).toContain('<pre>literal text</pre>');
    },
  },
  '<:import src="file.htm" />': {
    works: async () => {
      const p = await run(
        '<html><head><:import src="imp.htm" /><:import src="imp.htm" /></head>' +
          '<body><my-imp /></body></html>',
        { 'imp.htm': '<lib><:define tag="my-imp:i">imported</:define></lib>' }
      );
      expect(p.body()).toContain('imported');
      // imported once per page however many times it is asked for
      expect(p.body().match(/imported/g)?.length).toBe(1);
    },
  },
  '<:define tag="x-y:button">...</:define>': {
    works: async () => {
      const p = await run(
        '<html><head><:define tag="my-b:i" :label="L">${label}</:define></head>' +
          '<body><my-b :label=${"defined"} /></body></html>'
      );
      expect(p.body()).toContain('defined');
      expect(p.body()).not.toContain('<my-b');
    },
  },
  '<:slot />': {
    works: async () => {
      const p = await run(
        '<html><head><:define tag="my-s:i"><b><:slot>fallback</:slot></b></:define></head>' +
          '<body><my-s>filled</my-s><my-s /></body></html>'
      );
      expect(p.body()).toContain('<b>filled</b>');
      expect(p.body()).toContain('<b>fallback</b>');
    },
  },
  '<:slot name="x" />': {
    works: async () => {
      const p = await run(
        '<html><head><:define tag="my-n:i"><b><:slot name="s" /></b></:define></head>' +
          '<body><my-n><u :slot="s">named</u></my-n></body></html>'
      );
      expect(p.body()).toContain('<b><u>named</u></b>');
    },
  },
  ':slot="x"': {
    works: async () => {
      // the usage-site half of the pair: content goes where it is addressed,
      // not where it was written
      const p = await run(
        '<html><head><:define tag="my-t:i"><b><:slot name="s" /></b><u><:slot /></u>' +
          '</:define></head><body><my-t><em :slot="s">addressed</em>plain</my-t></body></html>'
      );
      expect(p.body()).toContain('<b><em>addressed</em></b>');
      expect(p.body()).toContain('<u>plain</u>');
    },
  },

  // -- Runtime-supplied values ---------------------------------------------
  $id: {
    works: async () => {
      const p = await run('<html><body><i id="x-${$id}">a</i><u id="y-${$id}">b</u></body></html>');
      const ids = [...p.body().matchAll(/id="([^"]+)"/g)].map(m => m[1]);
      expect(ids.length).toBe(2);
      expect(new Set(ids).size).toBe(2);
    },
  },
  $parent: {
    works: async () => {
      const p = await run('<html :v=${"outer"}><body><i :n=${1}>${$parent.v}</i></body></html>');
      expect(p.body()).toContain('outer');
    },
  },
  '$value("key")': {
    works: async () => {
      const p = await run('<html :v=${"A"}><body><i>${$value("v").get()}</i></body></html>');
      expect(p.body()).toContain('<i>A</i>');
    },
  },
};

// ---------------------------------------------------------------------------

describe('every documented directive', () => {
  const rows = documentedRows();

  beforeAll(() => {
    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-directives-'));
  });

  afterAll(() => {
    fs.existsSync(docroot) && fs.rmSync(docroot, { recursive: true });
  });

  it('reads the reference', () => {
    // the extractor quietly matching nothing would make all of this vacuous
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.some(r => r.syntax === ':for-each=${expr}')).toBe(true);
  });

  it('has a case for every row, and a row for every case', () => {
    const documented = rows.map(r => r.syntax).sort();
    const covered = Object.keys(CASES).sort();
    // named both ways round so the failure says which side moved
    expect(documented.filter(s => !covered.includes(s))).toStrictEqual([]);
    expect(covered.filter(s => !documented.includes(s))).toStrictEqual([]);
  });

  for (const row of rows) {
    const c = CASES[row.syntax];
    if (!c) continue; // the coverage test above reports it
    const marked = /not implemented/i.test(row.meaning);
    const claimsWorking = 'works' in c;

    it(`${marked ? 'is refused or inert, as documented' : 'does something'}: ${row.syntax}`, async () => {
      // the doc row and the case have to agree about which kind it is, or a
      // directive could be built while the docs still call it unfinished
      expect(claimsWorking).toBe(!marked);
      await ('works' in c ? c.works() : c.unimplemented());
    });
  }
});
