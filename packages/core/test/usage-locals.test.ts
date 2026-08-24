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
  const errors = page.errors.filter(e => e.type === 'error').map(e => e.msg);
  const warnings = page.errors.filter(e => e.type === 'warning').map(e => e.msg);
  if (errors.length)
    return { errors, warnings, body: () => '', root: null as any, rt: [] as string[] };
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
  return { errors, warnings, body, root: ctx.root.proxy as any, rt };
}

const BUTTON =
  '<:define tag="bs-button:button" ::variant=${\'primary\'} class=${\'btn btn-\' + variant}>' +
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
      '<:define tag="x-box:div" ::tone=${"warm"}>${tone}</:define>' +
      '<x-box :tone2=${"cold"} />' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('>warm</div>');
  });

  it('cannot shade a private the definition reads', () => {
    const p = render(
      '<html><body>' +
      '<:define tag="x-box:div" ::label=${"hi"} :_cls=${"box " + label} class=${_cls}>' +
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
      '<bs-button ::variant=${variant}>go</bs-button>' +
      '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('btn btn-danger');
  });

  it('overrides the definition\'s default', () => {
    const p = render(
      '<html><body>' + BUTTON + '<bs-button ::variant=${"success"}>go</bs-button></body></html>'
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
      '<:define tag="x-src:div" ::data=${"none"} ::url=${""}>${data}:${url}</:define>' +
      '<x-src :for-each=${urls} ::url=${data} />' +
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
    ['an argument reads one', '<bs-button :count=${0} ::variant=${count ? "a" : "b"} />'],
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

describe('a definition states its interface, and the tag reserves it', () => {
  const BOX =
    '<:define tag="x-box:div" ::tone=${"warm"} :_cls=${"box " + tone} class=${_cls}>' +
    '${tone}</:define>';

  it('refuses a plain `:` on a name the tag takes', () => {
    // not ceremony: `:` claims the name for the CALLER, and this one is not
    // the caller's to claim
    const p = render('<html><body>' + BOX + '<x-box :tone=${"cold"} /></body></html>');
    expect(p.errors).toStrictEqual([
      '"tone" is a parameter of <x-box>: write "::tone" to pass it, or pick ' +
        'another name for a value of your own',
    ]);
  });

  it('refuses a `::` on a name it does not', () => {
    const p = render('<html><body>' + BOX + '<x-box ::tonne=${"cold"} /></body></html>');
    expect(p.errors).toStrictEqual(['<x-box> has no parameter "tonne": it takes "tone"']);
  });

  it('says the same thing when the usage is replicated -- issue #32', () => {
    // The bug this closes: adding `:for-each` used to change the DIAGNOSIS.
    // Without it, `:tone` on a tag that takes `::tone` was a clean compile
    // error; with it, the error was lost and the build exited 0 having
    // written a page with the values missing, reporting only a `link`
    // warning naming a generated scope id. Two spellings left nothing for
    // the loop to tip, but nothing pins that until this does
    const one = render('<html><body>' + BOX + '<x-box :tone=${"cold"} /></body></html>');
    const many = render(
      '<html><body>' + BOX + '<x-box :for-each=${[1, 2]} :tone=${"cold"} /></body></html>'
    );
    expect(many.errors).toStrictEqual(one.errors);
    expect(many.errors).toStrictEqual([
      '"tone" is a parameter of <x-box>: write "::tone" to pass it, or pick ' +
        'another name for a value of your own',
    ]);
  });

  it('passes a parameter into every replica -- issue #32, the other half', () => {
    // and the spelling that IS right keeps working per replica, so the fix
    // is not "the loop errors now"
    const p = render(
      '<html><body>' +
        BOX +
        '<x-box :for-each=${["a", "b"]} ::tone=${data} /></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('>a<');
    expect(p.body()).toContain('>b<');
  });

  it('says so plainly when the tag takes none at all', () => {
    const p = render(
      '<html><body><:define tag="x-p:p">hi</:define><x-p ::title="t" /></body></html>'
    );
    expect(p.errors).toStrictEqual(['<x-p> has no parameter "title" -- it declares none']);
  });

  it('leaves a plain `:` on the define root PRIVATE, and free to be reused', () => {
    // `_cls` is the component's own and is not in the interface, so the same
    // name at a usage site is simply a local -- it collides with nothing and
    // the component keeps its computed class
    const p = render(
      '<html><body>' +
        '<:define tag="x-slotbox:div" ::tone=${"warm"} :_cls=${"box " + tone} ' +
        'class=${_cls}><:slot /></:define>' +
        '<x-slotbox :_cls=${"mine"}>${_cls}</x-slotbox>' +
        '</body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.body()).toContain('class="box warm"');
    expect(p.body()).toContain('mine');
  });

  it('refuses setting a private through the interface mark', () => {
    const p = render('<html><body>' + BOX + '<x-box ::_cls=${"mine"} /></body></html>');
    expect(p.errors).toStrictEqual(['<x-box> has no parameter "_cls": it takes "tone"']);
  });
});

describe('`::` where there is no interface', () => {
  it('is refused on an ordinary element', () => {
    const p = render('<html><body><div ::x=${1}>${x}</div></body></html>');
    expect(p.errors[0]).toContain('"::x" is not a parameter of anything');
  });

  it('is refused on a family, which names something outside markout', () => {
    const p = render(
      '<html><body><:define tag="x-q:div" ::class-on=${true}>q</:define></body></html>'
    );
    expect(p.errors[0]).toContain('is not a value');
  });

  it('cannot also be compile-time', () => {
    // a constant is substituted into readers every instance shares, so there
    // is nothing a per-usage override could substitute into
    const p = render(
      '<html><body><:define tag="x-r:div" ::const-w=${4}>r</:define></body></html>'
    );
    expect(p.errors[0]).toContain('cannot be both a parameter and compile-time');
  });
});

describe('a local nothing reads', () => {
  const BTN = '<:define tag="w-b:button" ::variant=${"a"}><:slot /></:define>';

  it('is a warning, not an error -- and the page still builds', () => {
    const p = render('<html><body>' + BTN + '<w-b :orphan=${1}>hi</w-b></body></html>');
    expect(p.errors).toStrictEqual([]);
    expect(p.warnings).toStrictEqual(['nothing reads "orphan", declared on <w-b>']);
    expect(p.body()).toContain('hi');
  });

  it('names the parameter when the local looks like a misspelling of one', () => {
    // the one shape reservation cannot catch: `:` claimed the name, so it is
    // a legal local, and only "nobody reads it" is left to notice
    const p = render('<html><body>' + BTN + '<w-b :varient="danger">hi</w-b></body></html>');
    expect(p.warnings).toStrictEqual([
      'nothing reads "varient": <w-b> takes "variant" -- did you mean "::variant"?',
    ]);
  });

  it('says nothing when a handler is the only thing using it', () => {
    // a callback body is resolved for its errors and recorded as a
    // dependency nowhere, so a naive "who depends on this" would call this
    // unused. State written by a handler and displayed nowhere is state
    const p = render(
      '<html><body>' + BTN + '<w-b :log=${""} :on-click=${() => log = "x"}>hi</w-b></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(p.warnings).toStrictEqual([]);
  });

  it('says nothing about a per-item alias nobody wrote', () => {
    const p = render(
      '<html><body :rows=${[1, 2]}>' + BTN + '<w-b :for-each=${rows}>hi</w-b></body></html>'
    );
    expect(p.warnings).toStrictEqual([]);
  });
});
