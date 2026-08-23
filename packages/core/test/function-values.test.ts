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
 * What a value holding a function means, and why it re-evaluates.
 *
 * A helper kept in a value -- `:fmt=${(n) => n + suffix}` -- is consumed by
 * being CALLED. Its result then depends on `suffix`, but the caller,
 * `${fmt(count)}`, mentions only `fmt` and `count` and has no way to depend
 * on `suffix` at all. The single path from one to the other is:
 *
 *     suffix changes -> fmt re-evaluates -> the new closure is a DIFFERENT
 *     object -> that difference propagates -> the caller recomputes
 *
 * Every link is load-bearing, and none of them is obvious. Two plausible
 * improvements would each cut the chain and produce a value that quietly
 * stops updating, with nothing thrown and nothing logged:
 *
 *  - dropping a function value's body references, on the grounds that "the
 *    body only runs when called"
 *  - memoising or hoisting a closure, so re-evaluation returns the same
 *    object and the propagation step finds nothing changed
 *
 * These tests exist to fail loudly for both. If one does fail, the fix is
 * not to update the expectation.
 */

function render(html: string) {
  const page = new Page(parse(html, 'fn.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  // collected, never thrown: a handler that throws is caught by propagate()
  // and reported again, which turns one failure into a cascade
  const errors: string[] = [];
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: e => errors.push(`${e.phase}/${e.key}: ${e.message}`),
  }).refresh();
  expect(errors).toStrictEqual([]);
  const shown = () => {
    const markup = page.source.doc.toString().replace(/<!--.*?-->/g, '');
    return /<p>([^<]*)<\/p>/.exec(markup.slice(markup.indexOf('<body')))?.[1];
  };
  // `<body>`'s scope, where these pages declare everything
  return { ctx, shown, errors, body: ctx.root.children[1] as any };
}

const HELPER =
  '<html><body :suffix=${"!"} :fmt=${(n) => n + suffix} :count=${1}>' +
  '<p>${fmt(count)}</p></body></html>';

describe('a value holding a function', () => {
  it('re-runs its caller when something only its body reads changes', () => {
    // the behaviour users rely on, stated as a user would meet it
    const { shown, body, errors } = render(HELPER);
    expect(shown()).toBe('1!');

    body.proxy.suffix = '?';
    expect(shown()).toBe('1?');
    // nothing reported along the way: the update is a plain propagation,
    // not something recovered from
    expect(errors).toStrictEqual([]);
  });

  it('produces a NEW function object each time it re-evaluates', () => {
    // the mechanism the case above rides on, pinned separately so a failure
    // says which half broke. Memoising the closure would keep this identity
    // stable and silently disconnect every caller
    const { body } = render(HELPER);
    const before = body.proxy.fmt;

    body.proxy.suffix = '?';
    const after = body.proxy.fmt;

    expect(typeof before).toBe('function');
    expect(after).not.toBe(before);
  });

  it('still re-runs its caller when the caller own argument changes', () => {
    // the ordinary path, so a regression that breaks only the subtle one
    // can't hide behind this still working
    const { shown, body } = render(HELPER);

    body.proxy.count = 2;
    expect(shown()).toBe('2!');
  });

  it('keeps working through a function held in an object', () => {
    // the same chain with one more hop: `cfg` is rebuilt, so `${cfg.fmt(1)}`
    // recomputes. Nothing here is special-cased for functions, which is why
    // it falls out
    const { shown, body } = render(
      '<html><body :suffix=${"!"} :cfg=${{ fmt: (n) => n + suffix }}>' +
        '<p>${cfg.fmt(1)}</p></body></html>'
    );
    expect(shown()).toBe('1!');

    body.proxy.suffix = '?';
    expect(shown()).toBe('1?');
  });
});

describe('a value nothing can consume', () => {
  it('does not re-run when its body references change', () => {
    // an event handler is called by the DOM, never from inside another
    // value's expression, so no caller can go stale and its body is
    // deliberately not tracked. The evidence is the absence of dependencies
    const page = new Page(parse(
      '<html><body :n=${0}><button :on-click=${() => n++}>x</button></body></html>',
      'fn.html'
    ));
    stage1load(page);
    stage2validate(page);
    stage3qualify(page);
    stage4resolve(page);
    const button = page.global.children[0].children[1].children[0];
    expect(button.values.get('on$click')!.deps).toStrictEqual([]);
  });

  it('runs a :handle- for the value it names, and not for the rest', () => {
    // the same licence, and the same sharp edge: a handler reading `suffix`
    // will NOT re-run when `suffix` alone changes. Derive first when that
    // matters -- `:label=${count + suffix}` with `:handle-label`
    const { body } = render(
      '<html><body :suffix=${"!"} :count=${0} :seen=${[]}' +
        ' :handle-count=${(n) => { seen.push(n + suffix); }}><p>x</p></body></html>'
    );
    expect(body.proxy.seen).toStrictEqual(['0!']);

    body.proxy.suffix = '?';
    expect(body.proxy.seen).toStrictEqual(['0!']);

    body.proxy.count = 1;
    expect(body.proxy.seen).toStrictEqual(['0!', '1?']);
  });
});
