import { describe, expect, it } from 'vitest';
import { Page } from '../../../src/compiler/ir/Page';
import { stage1load } from '../../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../../src/compiler/stages/stage7-generate';
import { parse } from '../../../src/html/parser';
import type { RuntimeError } from '../../../src/runtime/core/core-context';
import { WebContext } from '../../../src/runtime/web/web-context';
import { loadProps } from '../../../src/render/props';

/**
 * `${...}` inside an element whose content is text rather than markup.
 *
 * A browser reads what is between `<textarea>`, `<style>` and `<title>` tags
 * as characters, so the comment markers every other interpolation is wrapped
 * in would arrive as literal text and the binding would have no comment node
 * to find. These elements hold their whole content as one node instead, with
 * the marker just outside the tag -- which then has to be found from the
 * sibling side when the element carries a scope of its own.
 */
function run(html: string) {
  const page = new Page(parse(html, 'atomic.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  const runtime: RuntimeError[] = [];
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: (e: RuntimeError) => runtime.push(e),
  }).refresh();
  return {
    ctx,
    errors: page.errors.map(e => e.msg),
    runtime: runtime.map(e => `${e.phase}: ${e.message}`),
    // ids are noise here; what matters is what sits between the tags
    markup: () => page.source.doc.toString().replace(/ data-markout="[^"]*"/g, ''),
  };
}

describe('interpolation inside a raw-text element', () => {
  it('renders a textarea\'s content without leaking its markers into it', () => {
    const { errors, runtime, markup } = run(
      '<html><body :v=${"typed"}><textarea>${v}</textarea></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('<textarea>typed</textarea>');
  });

  it('keeps the binding live when the textarea has a scope of its own', () => {
    // the marker sits OUTSIDE the element, so it belongs to the parent's
    // territory while the text value belongs to this scope -- the case that
    // reported "unbound binding: no text node carrying that marker id"
    const { ctx, errors, runtime, markup } = run(
      '<html><body :v=${"first"}>' +
        '<textarea :on-input=${(ev) => v = ev}>${v}</textarea></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('<textarea>first</textarea>');

    ctx.root.proxy.body.v = 'second';
    expect(markup()).toContain('<textarea>second</textarea>');
  });

  it('binds even when the value starts out empty', () => {
    // an interpolation that renders empty serializes to nothing at all, so
    // the element comes back with no text child for the binding to hold
    const { ctx, errors, runtime, markup } = run(
      '<html><body :v=${""}><textarea :on-input=${(ev) => v = ev}>${v}</textarea></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('<textarea></textarea>');

    ctx.root.proxy.body.v = 'later';
    expect(markup()).toContain('<textarea>later</textarea>');
  });

  it('still does the same for style and title', () => {
    const { errors, runtime, markup } = run(
      '<html :c=${"red"} :t=${"Hello"}><head><title>${t}</title>' +
        '<style>body { color: ${c}; }</style></head><body></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('<title>Hello</title>');
    expect(markup()).toContain('color: red;');
  });
});
