import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../../../src/compiler';
import { renderPage } from '../../../src/render/render';
import { hydrate } from '../../../src/render/hydrate';

/**
 * Composed attributes on an element that is not HTML.
 *
 * `className` is HTML's property alone: on an SVG element the DOM answers
 * with an `SVGAnimatedString`, and the class machinery -- which read it to
 * find what was already on the element -- was handed an object and threw
 * `.split is not a function`. It surfaced as a [callback] error in the
 * browser and nowhere else: a `ServerElement`'s `className` really is a
 * string, so a served page was correct and only the first update failed.
 * An icon component whose root is `<svg>` is the everyday shape of it.
 *
 * happy-dom answers with a plain string, which is why the suite could not
 * see this. `browserShapedClassName` below puts the real DOM's answer back.
 */

let docroot: string;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-svg-'));
});

afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

/**
 * What Chromium, Firefox and Safari return for `svgElement.className`.
 *
 * Verified against a real browser rather than assumed: `String(...)` is
 * `"[object SVGAnimatedString]"` and there is no `split` on it, while
 * `classList` and `getAttribute('class')` work exactly as they do on an
 * HTML element.
 */
function browserShapedClassName(el: object): void {
  Object.defineProperty(Object.getPrototypeOf(el), 'className', {
    configurable: true,
    get(this: { getAttribute(n: string): string | null }) {
      const self = this;
      return {
        get baseVal() {
          return self.getAttribute('class') ?? '';
        },
        toString: () => '[object SVGAnimatedString]',
      };
    },
  });
}

let seq = 0;

async function mount(page: string, files: Record<string, string> = {}) {
  for (const [file, code] of Object.entries(files)) {
    fs.writeFileSync(path.join(docroot, file), code);
  }
  const name = `s${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), page);
  const compiled = await new Compiler({ docroot }).compile(`/${name}`);
  expect(compiled.errors.map(e => `${e.type}: ${e.msg}`)).toStrictEqual([]);
  expect(await renderPage(compiled)).toStrictEqual([]);

  const window = new Window();
  window.document.write(compiled.source.doc.toString());
  const svg = window.document.querySelector('svg');
  svg && browserShapedClassName(svg);
  const mounted = hydrate(compiled, { doc: window.document as any });
  const classes = () =>
    (window.document.querySelector('svg')?.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter(t => t)
      .sort();
  return { ...mounted, classes, doc: window.document };
}

/** an icon component, the shape every kit writes it in */
const ICON =
  '<lib><:define tag="ui-icon:svg" ::name="menu" ::extra=${null} ::label=${null}' +
  ' class=${extra} viewBox="0 0 24 24" role=${label ? "img" : null}>' +
  '<use href="#${name}" /></:define></lib>';

describe('class composition on an <svg>', () => {
  it('toggles a class without failing on SVGAnimatedString', async () => {
    const p = await mount(
      '<html><body :on=${false}><svg :class-lit=${on} viewBox="0 0 1 1"></svg></body></html>'
    );
    expect(p.classes()).toStrictEqual([]);
    p.root.body.on = true;
    // used to be: [callback] `s.split is not a function`, and no class at all
    expect(p.errors).toStrictEqual([]);
    expect(p.classes()).toStrictEqual(['lit']);
    p.root.body.on = false;
    expect(p.classes()).toStrictEqual([]);
  });

  it('leaves a class it never put on where it was', async () => {
    const p = await mount(
      '<html><body :on=${false}><svg :class-lit=${on} viewBox="0 0 1 1"></svg></body></html>'
    );
    p.doc.querySelector('svg')!.classList.add('theirs');
    p.root.body.on = true;
    expect(p.classes()).toStrictEqual(['lit', 'theirs']);
  });

  it('composes a computed base with a contribution', async () => {
    const p = await mount(
      '<html><body :v=${"solid"}><svg class=${"icon icon-" + v} class+=${["mine"]}' +
        ' viewBox="0 0 1 1"></svg></body></html>'
    );
    expect(p.classes()).toStrictEqual(['icon', 'icon-solid', 'mine']);
    p.root.body.v = 'ghost';
    expect(p.errors).toStrictEqual([]);
    expect(p.classes()).toStrictEqual(['icon', 'icon-ghost', 'mine']);
  });

  it('updates an icon whose class is null and whose name is reactive', async () => {
    const p = await mount(
      '<html><head><:import src="/icon.htm" /></head><body :open=${false}>' +
        '<ui-icon ::name=${open ? "x" : "menu"} class+=${["w-6"]} /></body></html>',
      { 'icon.htm': ICON }
    );
    expect(p.classes()).toStrictEqual(['w-6']);
    p.root.body.open = true;
    expect(p.errors).toStrictEqual([]);
    expect(p.doc.querySelector('use')!.getAttribute('href')).toBe('#x');
    expect(p.classes()).toStrictEqual(['w-6']);
  });
});
