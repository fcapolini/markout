import { describe, expect, it } from 'vitest';
import { Page } from '../src/compiler/ir/Page';
import { stage1load } from '../src/compiler/stages/stage1-load';
import { stage2validate } from '../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../src/compiler/stages/stage7-generate';
import { parse } from '../src/html/parser';
import type { RuntimeError } from '../src/runtime/core/core-context';
import { WebContext } from '../src/runtime/web/web-context';
import { renderPage } from '../src/render/render';
import { loadProps } from '../src/render/props';

/**
 * `class+=`, `class-=`, `style+=`, `style-=`.
 *
 * A plain attribute REPLACES; its `+=`/`-=` forms contribute. The case they
 * exist for is a usage site arguing with a definition that sets `class`
 * itself -- which used to need a `::extra` parameter per component, hand-
 * rolled in every kit, because a `class` written at a usage site silently
 * threw away the one the definition had computed.
 */
async function run(html: string) {
  const page = new Page(parse(html, 'set-ops.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  const errors = page.errors.filter(e => e.type === 'error').map(e => e.msg);
  const warnings = page.errors.filter(e => e.type === 'warning').map(e => e.msg);
  if (errors.length) return { errors, warnings, ctx: undefined, served: '', page };
  stage7generate(page);
  const runtimeErrors: string[] = [];
  await renderPage(page);
  const served = page.source.doc.toString();
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: (e: RuntimeError) => runtimeErrors.push(e.message),
  }).refresh();
  return { errors, warnings, ctx, served, page, runtimeErrors };
}

/**
 * The last `<div>`'s class names, as a SET.
 *
 * Order is not preserved across an update and deliberately isn't: the whole
 * point is to move the difference rather than rewrite the attribute, so a
 * name that stays put stays where it was and a new one lands at the end.
 * CSS has never cared, and caring here would mean writing the whole
 * attribute again -- which is what destroys everything else that has a say.
 */
function classes(page: Page): string[] {
  const all = [...page.source.doc.toString().matchAll(/<div [^>]*class="([^"]*)"/g)];
  return (all.at(-1)?.[1] ?? '').split(/\s+/).filter(t => t).sort();
}

function styles(page: Page): string | undefined {
  return [...page.source.doc.toString().matchAll(/<div [^>]*style="([^"]*)"/g)].at(-1)?.[1];
}

const BOX = '<:define tag="my-box:div" ::variant=${"red"} class=${"box box-" + variant}><:slot /></:define>';

describe('adding to a composite attribute', () => {
  it('adds a literal list of classes to what a definition set', async () => {
    const { errors, served } = await run(
      `<html><head>${BOX}</head><body><my-box class+="mb-0 shadow-sm">hi</my-box></body></html>`
    );
    expect(errors).toStrictEqual([]);
    expect(served).toContain('<div class="box box-red mb-0 shadow-sm"');
  });

  it('adds an expression\'s string[]', async () => {
    const { errors, served } = await run(
      '<html :extra=${["mb-0"]}><head>' +
        BOX +
        '</head><body><my-box class+=${[...extra, "shadow-sm"]}>hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(served).toContain('<div class="box box-red mb-0 shadow-sm"');
  });

  it('takes away a class the definition set', async () => {
    const { errors, served } = await run(
      '<html><head><:define tag="my-box:div" class="alert fade show"><:slot /></:define></head>' +
        '<body><my-box class-="fade">hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(served).toContain('<div class="alert show"');
  });

  it('leaves a plain `class` replacing, which is the rule it does not change', async () => {
    const { errors, warnings, served } = await run(
      '<html><head><:define tag="my-box:div" class="box"><:slot /></:define></head>' +
        '<body><my-box class="mine">hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(served).toContain('<div class="mine"');
    // legal, and said out loud, because it is almost never what was meant
    expect(warnings).toStrictEqual([
      '<my-box> sets "class" itself, and a "class" here replaces it -- did you mean "class+="?',
    ]);
  });

  it('replaces a class the definition COMPUTES, not only a static one', async () => {
    // one rule, two behaviours before this: the computed one is a value,
    // values land after the instance's static attributes, and so a usage
    // site's `class` was thrown away by a component that derived its own
    const { errors, warnings, served } = await run(
      `<html><head>${BOX}</head><body><my-box class="mine">hi</my-box></body></html>`
    );
    expect(errors).toStrictEqual([]);
    expect(served).toContain('<div class="mine"');
    expect(served).not.toContain('box-red');
    expect(warnings).toStrictEqual([
      '<my-box> sets "class" itself, and a "class" here replaces it -- did you mean "class+="?',
    ]);
  });

  it('says nothing where the component sets no class of its own', async () => {
    const { errors, warnings, served } = await run(
      '<html><head><:define tag="my-box:div" ::v=${1}><:slot /></:define></head>' +
        '<body><my-box class="mine">hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(warnings).toStrictEqual([]);
    expect(served).toContain('<div class="mine"');
  });

  it('says nothing when the caller used the spelling that adds', async () => {
    const { errors, warnings } = await run(
      `<html><head>${BOX}</head><body><my-box class+="mine">hi</my-box></body></html>`
    );
    expect(errors).toStrictEqual([]);
    expect(warnings).toStrictEqual([]);
  });

  it('warns about style on the same terms', async () => {
    const { errors, warnings } = await run(
      '<html :c=${"red"}><head><:define tag="my-box:div" style="gap: 1rem"><:slot /></:define>' +
        '</head><body><my-box style=${"color: " + c}>hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(warnings).toStrictEqual([
      '<my-box> sets "style" itself, and a "style" here replaces it -- did you mean "style+="?',
    ]);
  });

  it('adds and removes style declarations', async () => {
    const { errors, served } = await run(
      '<html><head><:define tag="my-box:div" style="color: red; gap: 1rem"><:slot /></:define></head>' +
        '<body><my-box style+="color: blue; margin: 0" style-="gap">hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(served).toContain('style="color: blue; margin: 0;"');
  });

  it("carries a definition's static style onto its instances", async () => {
    // `class` and `style` are element properties rather than attribute
    // nodes, and only the first was copied when a definition was expanded --
    // so a static style on a `<:define>` reached nothing, which makes
    // `style+=` an argument with a base that was never there
    const { errors, served } = await run(
      '<html><head><:define tag="my-box:div" style="gap: 1rem" class="box">' +
        '<:slot /></:define></head><body><my-box>hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(served).toContain('<div class="box" style="gap: 1rem;"');
  });

  it('takes a { property: value } map from an expression', async () => {
    const { errors, served } = await run(
      '<html :accent=${"teal"}><head><:define tag="my-box:div" style="color: red"><:slot /></:define>' +
        '</head><body><my-box style+=${{ color: accent, "border-width": "1px" }}>hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(served).toContain('style="color: teal; border-width: 1px;"');
  });
});

describe('composing, rather than assigning', () => {
  it('keeps a contribution when the base re-runs -- the bug this fixes', async () => {
    const { errors, ctx, page } = await run(
      `<html :v=\${"red"}><head>${BOX}</head>` +
        '<body><my-box ::variant=${v} class+="mine" :class-on>hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(classes(page)).toStrictEqual(['box', 'box-red', 'mine', 'on']);
    ctx!.root.proxy.v = 'green';
    // `mine` and `on` used to be gone here: writing the whole attribute is
    // what destroyed everything else that had a say in it
    expect(classes(page)).toStrictEqual(['box', 'box-green', 'mine', 'on']);
  });

  it('leaves a class it never put on where it was', async () => {
    const { errors, ctx, page } = await run(
      `<html :v=\${"red"}><head>${BOX}</head><body><my-box ::variant=\${v}>hi</my-box></body></html>`
    );
    expect(errors).toStrictEqual([]);
    // what a third party -- Bootstrap's own JS, in the kit's five plugin
    // components -- does to an element markout also writes
    const el = ctx!.root.children.at(-1)!.children.at(-1)!;
    (el as unknown as { dom: { classList: { add(s: string): void } } }).dom.classList.add('show');
    ctx!.root.proxy.v = 'green';
    expect(classes(page)).toStrictEqual(['box', 'box-green', 'show']);
  });

  it('removes after adding, whichever order they are written in', async () => {
    const before = await run(
      '<html><head><:define tag="my-box:div" class="alert"><:slot /></:define></head>' +
        '<body><my-box class-="fade" class+="fade mine">hi</my-box></body></html>'
    );
    const after = await run(
      '<html><head><:define tag="my-box:div" class="alert"><:slot /></:define></head>' +
        '<body><my-box class+="fade mine" class-="fade">hi</my-box></body></html>'
    );
    expect(before.errors).toStrictEqual([]);
    expect(after.errors).toStrictEqual([]);
    expect(before.served).toContain('<div class="alert mine"');
    expect(after.served).toContain('<div class="alert mine"');
  });

  it('takes its contribution back off after hydration', async () => {
    // the base is what the DEFINITION set, and after a round trip the class
    // standing on the element is the SERVED one -- contributions included.
    // Reading that for the base is what left `lit` on forever
    const { errors, ctx, page } = await run(
      '<html :on=${true}><head><:define tag="my-box:div" class="alert"><:slot /></:define></head>' +
        '<body><my-box class+=${on ? ["lit"] : []}>hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(classes(page)).toStrictEqual(['alert', 'lit']);
    ctx!.root.proxy.on = false;
    expect(classes(page)).toStrictEqual(['alert']);
  });

  it('takes the base from its own element, not from what was slotted in', async () => {
    // an element with no scope of its own is loaded against the enclosing
    // one, so a card's base was once read off the first paragraph slotted
    // into it -- which compiled clean and rendered `class="mb-0 ..."`
    const { errors, served } = await run(
      '<html><head><:define tag="my-card:div" class="card">' +
        '<div class="card-body"><:slot /></div></:define></head>' +
        '<body><my-card class+="mt-4"><p class="mb-0">hi</p></my-card></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(served).toContain('<div class="card mt-4"');
    expect(served).toContain('<p class="mb-0">hi</p>');
  });

  it('reads a falsy toggle as the removal it always was', async () => {
    const { errors, ctx, page } = await run(
      '<html :on=${true}><head><:define tag="my-box:div" class="alert"><:slot /></:define></head>' +
        '<body><my-box :class-fade=${on}>hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(classes(page)).toStrictEqual(['alert', 'fade']);
    ctx!.root.proxy.on = false;
    expect(classes(page)).toStrictEqual(['alert']);
  });

  it('composes a style the same way', async () => {
    const { errors, ctx, page } = await run(
      '<html :c=${"red"}><head><:define tag="my-box:div" ::c=${"red"} style=${"color: " + c}>' +
        '<:slot /></:define></head>' +
        '<body><my-box ::c=${c} style+="margin: 0">hi</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(styles(page)).toBe('color: red; margin: 0;');
    ctx!.root.proxy.c = 'blue';
    expect(styles(page)).toBe('color: blue; margin: 0;');
  });
});

describe('what it refuses', () => {
  it('refuses an operator on an attribute that holds a value', async () => {
    const { errors } = await run('<html><body><div title+="x"></div></body></html>');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"title+" is not an attribute');
    expect(errors[0]).toContain('Only "class" and "style" hold a set');
  });

  it('refuses an interpolation, which is always a string', async () => {
    const { errors } = await run(
      '<html :x=${"a"}><body><div class+="mb-0 ${x}"></div></body></html>'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"class+" takes a string[]');
    expect(errors[0]).toContain('an interpolation is always a string');
  });

  it('refuses a string expression, naming the map shape for style', async () => {
    const { errors } = await run('<html><body><div style+=${"color: red"}></div></body></html>');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"style+" takes a { property: value } map');
  });

  it('refuses one with nothing to contribute', async () => {
    const { errors } = await run('<html><body><div class+></div></body></html>');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"class+" needs a value');
  });

  it('reports a string the compiler could not see, rather than spreading it', async () => {
    const { errors, runtimeErrors } = await run(
      '<html :on=${true}><body><div class+=${on ? "a b" : "c"}></div></body></html>'
    );
    expect(errors).toStrictEqual([]);
    // `[...'a b']` would have been three classes named `a`, ` ` and `b`
    expect(runtimeErrors!.join('\n')).toContain('"class+" takes a string[]');
    expect(runtimeErrors!.join('\n')).toContain('the string "a b"');
  });
});

describe('what a served page carries', () => {
  it('keeps the operators out of the markup, literal or not', async () => {
    const { errors, served } = await run(
      '<html><body><div class="a" class+="b" class-="a" style+="color: red"></div></body></html>'
    );
    expect(errors).toStrictEqual([]);
    const markup = served.slice(served.indexOf('<div'), served.indexOf('</div>'));
    expect(markup).not.toContain('class+');
    expect(markup).not.toContain('class-');
    expect(markup).not.toContain('style+');
    expect(markup).toContain('<div class="b" style="color: red;"');
  });
});
