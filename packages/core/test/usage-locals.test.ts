import { describe, expect, it } from 'vitest';
import { Page } from '../src/compiler/ir/Page';
import { stage1load } from '../src/compiler/stages/stage1-load';
import { stage2validate } from '../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../src/compiler/stages/stage7-generate';
import { parse } from '../src/html/parser';
import { WebContext } from '../src/runtime/web/web-context';
import { loadProps } from '../src/render/props';

/**
 * A custom tag's usage site is two things at once: a call, and an element in
 * the caller's markup. These pin the second -- state hung on the tag the way
 * it can be hung on any native element -- and the line between them.
 */
function render(html: string) {
  const page = new Page(parse(html, 'usage-locals.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  const errors = page.errors.map(e => e.msg);
  if (errors.length) return { errors, body: () => '', root: null as any, rt: [] as string[] };
  const rt: string[] = [];
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: (e: any) => rt.push(`${e.phase}/${e.key}: ${e.message}`),
  }).refresh();
  const body = () => {
    const m = page.source.doc.toString().replace(/<!--.*?-->/g, '');
    return m.slice(m.indexOf('<body'), m.indexOf('<script'));
  };
  return { errors, body, root: ctx.root.proxy as any, rt };
}

const BUTTON =
  '<:define tag="bs-button:button" :variant=${\'primary\'} class=${\'btn btn-\' + variant}>' +
  '<:slot /></:define>';

describe('a name the tag takes no parameter for', () => {
  it('is the usage site\'s own, and its siblings see it', () => {
    const p = render(
      '<html><body>' + BUTTON +
      '<bs-button :count=${0} :doubled=${count * 2}>${count}/${doubled}</bs-button>' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('>0/0</button>');
    expect(p.rt).toStrictEqual([]);
  });

  it('is writable from a handler on the same tag', () => {
    const p = render(
      '<html><body>' + BUTTON +
      '<bs-button :count=${0} :on-click=${() => count++}>${count}</bs-button>' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('>0</button>');
  });

  it('does not reach the definition, which keeps its own name', () => {
    // `variant` here is the component's; a local of the same name would
    // shade it, which is what the routing exists to prevent
    const p = render(
      '<html><body>' +
      '<:define tag="x-box:div" :tone=${"warm"}>${tone}</:define>' +
      '<x-box :tone2=${"cold"} />' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('>warm</div>');
  });

  it('cannot shade a private the definition reads', () => {
    const p = render(
      '<html><body>' +
      '<:define tag="x-box:div" :label=${"hi"} :_cls=${"box " + label} class=${_cls}>' +
      '${label}</:define>' +
      '<x-box :_other=${"mine"} />' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('class="box hi"');
  });
});

describe('a name the tag does take', () => {
  it('is an argument, and reads its own name from OUT there', () => {
    // the pass-through idiom: `variant` on the right is the caller's
    const p = render(
      '<html><body :variant=${"danger"}>' + BUTTON +
      '<bs-button :variant=${variant}>go</bs-button>' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('btn btn-danger');
  });

  it('overrides the definition\'s default', () => {
    const p = render(
      '<html><body>' + BUTTON + '<bs-button :variant=${"success"}>go</bs-button></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('btn btn-success');
  });
});

describe('a replicated usage', () => {
  it('gives every replica a local of its own', () => {
    const p = render(
      '<html><body :rows=${[10, 20]}>' + BUTTON +
      '<bs-button :for-each=${rows} :n=${data * 2}>${n}</bs-button>' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('>20</button>');
    expect(p.body()).toContain('>40</button>');
  });

  it('still routes the per-item alias past a same-named parameter', () => {
    // `x-src` declares `:data`; the loop's alias is also `data`, and the
    // component must keep its own
    const p = render(
      '<html><body :urls=${["a", "b"]}>' +
      '<:define tag="x-src:div" :data=${"none"} :url=${""}>${data}:${url}</:define>' +
      '<x-src :for-each=${urls} :url=${data} />' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('none:a');
    expect(p.body()).toContain('none:b');
  });
});

describe('the shapes that used to be "Unknown reference"', () => {
  const cases: [string, string][] = [
    ['slot text reads a local', '<bs-button :count=${0}>${count}</bs-button>'],
    ['a handler reads one', '<bs-button :count=${0} :on-click=${() => count++} />'],
    ['an argument reads one', '<bs-button :count=${0} :variant=${count ? "a" : "b"} />'],
    ['a class toggle reads one', '<bs-button :hot=${true} :class-on=${hot} />'],
    ['a plain attribute reads one', '<bs-button :n=${2} id=${"b" + n} />'],
  ];
  for (const [what, markup] of cases) {
    it(what, () => {
      expect(render('<html><body>' + BUTTON + markup + '</body></html>').errors).toStrictEqual([]);
    });
  }
});

describe('what a usage site still cannot do', () => {
  it('reach into the definition for a name it does not declare', () => {
    // `_cls` is the component's own; the local of that name is the caller's,
    // and the two never meet
    const p = render(
      '<html><body>' +
      '<:define tag="x-box:div" :_cls=${"box"} class=${_cls}>hi</:define>' +
      '<x-box :other=${_cls} />' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual(['Unknown reference: "_cls"']);
  });

  it('hand the definition a name it never declared', () => {
    const p = render(
      '<html><body>' +
      '<:define tag="x-box:div">${extra}</:define>' +
      '<x-box :extra=${"nope"} />' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual(['Unknown reference: "extra"']);
  });
});
