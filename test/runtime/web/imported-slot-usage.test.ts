import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, assert, beforeAll, describe, it } from 'vitest';
import { Compiler } from '../../../src/compiler/index';
import { NodeType } from '../../../src/html/dom';
import { WebContext } from '../../../src/runtime/web/web-context';

/**
 * A custom-tag usage written INSIDE an imported library, given slotted
 * content.
 *
 * Filling a slot makes stage1 build a stencil per usage site and park it in
 * the page's <head> -- the one place in the compiler that navigates from a
 * document to a fixed location rather than inserting relative to a node.
 * An imported file's nodes keep pointing at THAT file's document, whose root
 * is its own `<lib>` and which has no <head>, so the stencil used to land in
 * a document nobody serves. The instance then came up with no DOM at all:
 * missing from the page, and reported only as `unbound binding: no element
 * to set "class" on` once its bindings tried to fire.
 *
 * Compiled through the real Compiler rather than the stages directly,
 * because the import machinery is what puts the two documents in play.
 */
describe('a slot filled at a usage site inside an imported library', () => {
  let dir: string;
  let compiler: Compiler;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-imported-slot-'));
    compiler = new Compiler({ docroot: dir });
    // the leaf library: one tag that takes content, one that has its own
    fs.writeFileSync(
      path.join(dir, 'button.htm'),
      '<lib>' +
        '<:define tag="mk-btn:a" :label=${"x"} class="btn-${label}"><:slot /></:define>' +
        '<:define tag="mk-fixed:a" :label=${"x"} class="fix-${label}">own</:define>' +
        '</lib>'
    );
    // a library that USES them -- this is what puts the usage site in a
    // document other than the page's
    fs.writeFileSync(
      path.join(dir, 'panel.htm'),
      '<lib><:import src="button.htm" />' +
        '<:define tag="mk-panel:div">' +
        '<mk-fixed :label=${"f"}></mk-fixed>' +
        '<mk-btn :label=${"b"}>slotted</mk-btn>' +
        '</:define></lib>'
    );
    fs.writeFileSync(
      path.join(dir, 'page.html'),
      '<html><head><:import src="panel.htm" /></head>' +
        '<body><mk-panel></mk-panel></body></html>'
    );
  });

  afterAll(() => fs.existsSync(dir) && fs.rmSync(dir, { recursive: true }));

  it('instantiates its DOM in the page, not in the library document', async () => {
    const page = await compiler.compile('/page.html');
    assert.deepEqual(
      page.errors.map((e: any) => e.msg),
      []
    );

    const root = new Function(`return (${page.propsString});`)();
    const errors: string[] = [];
    const ctx: any = new WebContext({ root, doc: page.source.doc });
    // the symptom reaches the page as a missing element and nothing else;
    // the diagnosis only ever shows up here
    const inherited = ctx.onError.bind(ctx);
    ctx.onError = (phase: string, err: unknown, ...rest: unknown[]) => {
      errors.push(`${phase}: ${err}`);
      return inherited(phase, err, ...rest);
    };
    ctx.refresh();

    const anchors = findAll(findByTag(page.source.doc, 'BODY'), 'A');
    assert.deepEqual(errors, []);
    // the tag with its own body always worked; the one given content is the
    // regression -- it used to be absent entirely
    assert.deepEqual(
      anchors.map(a => `${a.className}:${textOf(a)}`),
      ['fix-f:own', 'btn-b:slotted']
    );
  });
});

function findByTag(root: any, tagName: string): any {
  for (const n of root.childNodes ?? []) {
    if (n.tagName === tagName) return n;
    const found = findByTag(n, tagName);
    if (found) return found;
  }
  return undefined;
}

/** every matching element in document order, skipping <template> content so
 * a stencil can't be mistaken for the instantiated thing */
function findAll(root: any, tagName: string): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (n.tagName === 'TEMPLATE') return;
    if (n.tagName === tagName) out.push(n);
    for (const k of n.childNodes ?? []) walk(k);
  };
  walk(root);
  return out;
}

function textOf(el: any): string {
  return (el.childNodes ?? [])
    .filter((n: any) => n.nodeType === NodeType.TEXT)
    .map((n: any) => n.textContent)
    .join('')
    .trim();
}
