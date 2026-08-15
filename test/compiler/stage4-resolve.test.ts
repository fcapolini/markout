import { describe, expect, it, beforeEach } from 'vitest';
import * as acorn from 'acorn';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { GLOBAL_NAMES, stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { GLOBAL_NAMES as GLOBAL_NAMES_RT } from '../../src/runtime/core/core-global';
import { Page } from '../../src/compiler/ir/Page';
import { Scope } from '../../src/compiler/ir/Scope';
import { Value } from '../../src/compiler/ir/Value';
import { ServerAttribute, ServerDocument, SourceLocation } from '../../src/html/server-dom';
import { Source, parse } from '../../src/html/parser';

const LOC: SourceLocation = {
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
  i1: 0,
  i2: 0,
};

// simulates a value already qualified by stage3 (this.foo / this.$parent.foo)
function parseExpr(source: string): acorn.Expression {
  return acorn.parseExpressionAt(source, 0, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
  });
}

describe('stage4-resolve', () => {
  let doc: ServerDocument;
  let page: Page;

  beforeEach(() => {
    doc = new ServerDocument('test');
    const source = new Source('test.html', '<html></html>');
    source.doc = doc;
    page = new Page(source);
  });

  function addValue(scope: Scope, name: string, source: string | null) {
    const attr = new ServerAttribute(doc, null as any, `:${name}`, null, LOC);
    attr.value = source == null ? null : parseExpr(source);
    attr.valueLoc = LOC;
    const value = new Value(name, attr, scope);
    scope.values.set(name, value);
    return value;
  }

  it('should record no dependencies for a static literal', () => {
    const scope = new Scope(page, page.global);
    const attr = new ServerAttribute(doc, null as any, ':x', null, LOC);
    attr.value = 'a plain literal string';
    attr.valueLoc = LOC;
    const value = new Value('x', attr, scope);
    scope.values.set('x', value);

    stage4resolve(page);
    expect(value.deps).toStrictEqual([]);
  });

  it('should record a this.foo reference as a non-parent dependency', () => {
    const scope = new Scope(page, page.global);
    addValue(scope, 'count', null);
    const value = addValue(scope, 'x', 'this.count + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'count' }]);
  });

  it('should record a this.$parent.foo reference as a parent dependency', () => {
    const scope = new Scope(page, page.global);
    addValue(page.global, 'count', null);
    const value = addValue(scope, 'x', 'this.$parent.count + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ via: ['$parent'], key: 'count' }]);
  });

  it('should record a this.foo.bar reference as a named-scope dependency when foo is a known :aka scope', () => {
    const scope = new Scope(page, page.global);
    const foo = new Scope(page, page.global, undefined, 'foo');
    addValue(foo, 'bar', null);
    const value = addValue(scope, 'x', 'this.foo.bar + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ via: ['foo'], key: 'bar' }]);
  });

  it('should resolve a named scope reachable through an intermediate ancestor (ascends the IR tree)', () => {
    const middle = new Scope(page, page.global);
    const scope = new Scope(page, middle);
    const foo = new Scope(page, page.global, undefined, 'foo');
    addValue(foo, 'bar', null);
    const value = addValue(scope, 'x', 'this.foo.bar + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ via: ['foo'], key: 'bar' }]);
  });

  it('should NOT treat this.foo.bar as a scope reference when foo is just an ordinary value', () => {
    const scope = new Scope(page, page.global);
    addValue(page.global, 'items', null);
    const value = addValue(scope, 'x', 'this.items.filter');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'items' }]);
  });

  it('a closer ordinary value shadows a same-named scope further up', () => {
    const middle = new Scope(page, page.global);
    addValue(middle, 'foo', null);
    const scope = new Scope(page, middle);
    new Scope(page, page.global, undefined, 'foo');
    const value = addValue(scope, 'x', 'this.foo.bar + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'foo' }]);
  });

  it('should dedupe repeated references to the same dependency', () => {
    const scope = new Scope(page, page.global);
    addValue(scope, 'count', null);
    const value = addValue(scope, 'x', 'this.count + this.count * 2');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'count' }]);
  });

  it('should record multiple distinct dependencies', () => {
    const scope = new Scope(page, page.global);
    addValue(scope, 'a', null);
    addValue(page.global, 'b', null);
    const value = addValue(scope, 'x', 'this.a + this.$parent.b');

    stage4resolve(page);
    expect(value.deps).toEqual(
      expect.arrayContaining([
        { key: 'a' },
        { via: ['$parent'], key: 'b' },
      ])
    );
    expect(value.deps).toHaveLength(2);
  });

  it('should not record dependencies referenced only inside an event handler body', () => {
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'on$click', '() => this.count++');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([]);
  });

  it('should not record dependencies referenced only inside a lifecycle hook body', () => {
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'did$init', '() => this.count++');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([]);
  });

  it('should record dependencies for a value that HOLDS a function', () => {
    // deliberately not treated like a callback, even though it looks like
    // one. Whatever calls `fmt` can observe `suffix` through it, and cannot
    // depend on `suffix` itself -- re-evaluating `fmt` is the only path.
    // See the note in stage4-resolve.ts, and function-values.test.ts for
    // what breaks when this is "optimised"
    const scope = new Scope(page, page.global);
    addValue(scope, 'suffix', null);
    const value = addValue(scope, 'fmt', '(n) => n + this.suffix');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'suffix' }]);
  });

  it('should not record dependencies referenced only inside a will- hook body', () => {
    // the sibling of the on$/did$ cases: same rule, and it had no test
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'will$dispose', '() => this.count++');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([]);
  });

  it('should depend on what a :handle- names, and not on its body', () => {
    // stage1 rewrites `:handle-x=${fn}` into `fn(x)`, so the argument is a
    // dependency and the body is not: a handler observes the value it names.
    // Safe for the callback reason -- nothing consumes a handler's result
    const page2 = new Page(parse(
      '<html><body :other=${1}><div :count=${0} :handle-count=${(n) => other}></div>' +
        '</body></html>', 'test.html'));
    stage1load(page2);
    stage2validate(page2);
    stage3qualify(page2);
    stage4resolve(page2);
    const div = page2.global.children[0].children[1].children[0];
    expect(div.values.get('handle$count')!.deps).toStrictEqual([{ key: 'count' }]);
  });

  it('should still record dependencies for a regular value containing a nested arrow function', () => {
    const scope = new Scope(page, page.global);
    addValue(scope, 'items', null);
    addValue(scope, 'offset', null);
    const value = addValue(scope, 'x', 'this.items.map(item => item + this.offset)');

    stage4resolve(page);
    expect(value.deps).toEqual(
      expect.arrayContaining([
        { key: 'items' },
        { key: 'offset' },
      ])
    );
    expect(value.deps).toHaveLength(2);
  });

  it('should resolve text values too', () => {
    const scope = new Scope(page, page.global);
    addValue(scope, 'count', null);
    const textAttr = new ServerAttribute(doc, null as any, ':t$0', null, LOC);
    const textValue = new Value('t$0', textAttr, scope);
    textAttr.value = parseExpr('this.count');
    scope.textValues.set('t$0', textValue);

    stage4resolve(page);
    expect(textValue.deps).toStrictEqual([{ key: 'count' }]);
  });

  it('should recurse into child scopes', () => {
    const scope = new Scope(page, page.global);
    const child = new Scope(page, scope);
    addValue(child, 'count', null);
    const value = addValue(child, 'x', 'this.count');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'count' }]);
  });
});

describe('stage4-resolve: unknown reference validation', () => {
  function compile(html: string) {
    const p = new Page(parse(html, 'test.html'));
    stage1load(p);
    stage2validate(p);
    stage3qualify(p);
    stage4resolve(p);
    return p;
  }

  // asserted as the WHOLE error list, not with `toContain`: these used to be
  // reported twice each, because `page.main` is itself one of `page.global`'s
  // children and both were walked -- which a containment check can't see
  it('reports an error for a reference to an undeclared value', () => {
    const p = compile('<html><body><div :count=${0}><p>${bar}</p></div></body></html>');
    expect(p.errors.map(e => e.msg)).toStrictEqual(['Unknown reference: "bar"']);
  });

  it('reports an error for an undeclared property on a known named scope', () => {
    const p = compile(
      '<html><body><div :aka="foo" :x=${1}></div><p>${foo.nope}</p></body></html>'
    );
    expect(p.errors.map(e => e.msg)).toStrictEqual(['Unknown reference: "foo.nope"']);
  });

  it('reports an unknown reference in <head> exactly once', () => {
    const p = compile(
      '<html><head><title>Demo ${pippo}</title></head><body></body></html>'
    );
    expect(p.errors.map(e => e.msg)).toStrictEqual(['Unknown reference: "pippo"']);
  });

  it('reports each distinct unknown reference once, and separately', () => {
    const p = compile(
      '<html><body><p>${alpha}</p><p>${beta}</p></body></html>'
    );
    expect(p.errors.map(e => e.msg)).toStrictEqual([
      'Unknown reference: "alpha"',
      'Unknown reference: "beta"',
    ]);
  });

  it('does not error for a same-scope reference', () => {
    const p = compile('<html><body><div :count=${0}><p>${count}</p></div></body></html>');
    expect(p.errors).toStrictEqual([]);
  });

  it('does not error for a reference resolved through an ancestor scope', () => {
    const p = compile(
      '<html><body><div :items=${[1,2,3]}><li :for-each=${items}>${data}</li></div></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
  });

  it('does not error for a value declared on a known named scope', () => {
    const p = compile(
      '<html><body><div :aka="foo" :x=${1}></div><p>${foo.x}</p></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
  });

  it('does not error for a bare reference to a named scope itself', () => {
    const p = compile('<html><body><div :aka="foo"></div><p>${foo}</p></body></html>');
    expect(p.errors).toStrictEqual([]);
  });

  it('does not error for the runtime-provided $id', () => {
    const p = compile('<html><body><p>${$id}</p></body></html>');
    expect(p.errors).toStrictEqual([]);
  });
});

// A reference the compiler fails to record doesn't blow up at runtime -- it
// produces a binding that silently never updates. So every one of these
// asserts either the right dependency or an explicit error, never a
// quietly-dropped reference.
describe('stage4-resolve: chained scope navigation', () => {
  function compile(html: string) {
    const p = new Page(parse(html, 'test.html'));
    stage1load(p);
    stage2validate(p);
    stage3qualify(p);
    stage4resolve(p);
    return p;
  }

  // the value carrying the page's single interpolated text
  function textDeps(p: Page) {
    for (const [, v] of p.values) {
      if (v.name.startsWith('t$') && v.deps.length) return v.deps;
    }
    return [];
  }

  it('walks a chain through two named scopes down to the value', () => {
    const p = compile(
      '<html><body><div :aka="outer"><span :aka="inner" :count=${1}></span></div>' +
        '<p>${outer.inner.count}</p></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    // NOT [{ via: ['outer'], key: 'inner' }] -- that's the scope object,
    // which never changes, so `count` would never trigger an update
    expect(textDeps(p)).toStrictEqual([{ via: ['outer', 'inner'], key: 'count' }]);
  });

  it('walks repeated $parent hops down to the value', () => {
    const p = compile(
      '<html :n=${1}><body><div :aka="a"><span>${$parent.$parent.n}</span></div></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(textDeps(p)).toStrictEqual([{ via: ['$parent', '$parent'], key: 'n' }]);
  });

  it('walks a chain mixing a named scope and $parent', () => {
    const p = compile(
      '<html :n=${1}><body><div :aka="a"></div><p>${a.$parent.$parent.n}</p></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(textDeps(p)).toStrictEqual([
      { via: ['a', '$parent', '$parent'], key: 'n' },
    ]);
  });

  it('stops the chain at the first ordinary value and depends on that', () => {
    const p = compile(
      '<html :user=${{profile: {name: "ann"}}}><body><p>${user.profile.name}</p></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    // `profile`/`name` are plain properties of whatever `user` holds, not
    // scopes -- the value itself is the only thing that can change
    expect(textDeps(p)).toStrictEqual([{ key: 'user' }]);
  });

  it('reports an unknown value at the end of a resolved scope chain', () => {
    const p = compile(
      '<html><body><div :aka="outer"><span :aka="inner" :count=${1}></span></div>' +
        '<p>${outer.inner.nope}</p></body></html>'
    );
    expect(p.errors.map(e => e.msg)).toContain('Unknown reference: "outer.inner.nope"');
  });

  it('reports a $parent hop that walks off the top of the scope tree', () => {
    const p = compile('<html :n=${1}><body><p>${$parent.$parent.$parent.n}</p></body></html>');
    expect(p.errors.map(e => e.msg)).toContain(
      'Unknown reference: "$parent.$parent.$parent.n"'
    );
  });

  it('reports a computed property access on a scope instead of silently mistracking it', () => {
    const p = compile(
      '<html :k="count"><body><div :aka="outer" :count=${1}></div>' +
        '<p>${outer[k]}</p></body></html>'
    );
    expect(p.errors.map(e => e.msg)).toContain(
      'Cannot track dependencies through a computed property access on scope "outer"'
    );
  });

  it('still records both sides of a computed access on an ordinary value', () => {
    const p = compile(
      '<html :items=${[1,2]} :i=${0}><body><p>${items[i]}</p></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(textDeps(p)).toEqual(
      expect.arrayContaining([{ key: 'items' }, { key: 'i' }])
    );
    expect(textDeps(p)).toHaveLength(2);
  });
});

// `${...}` is meant to be plain JavaScript, and plain JavaScript says
// `Math.max(a, b)`. Since stage3 qualifies every free name to `this.<name>`,
// that only works if the standard library is reachable as the last link of
// the scope chain -- see runtime/core/core-global.ts for what is on the list
// and why the browser-only names are not.
describe('stage4-resolve: JS globals', () => {
  function compile(html: string) {
    const p = new Page(parse(html, 'test.html'));
    stage1load(p);
    stage2validate(p);
    stage3qualify(p);
    stage4resolve(p);
    return p;
  }

  function textDeps(p: Page) {
    for (const [, v] of p.values) {
      if (v.name.startsWith('t$') && v.deps.length) return v.deps;
    }
    return [];
  }

  it('resolves a standard-library reference without declaring it', () => {
    const p = compile('<html><body><p>${Math.max(1, 2)}</p></body></html>');
    expect(p.errors).toStrictEqual([]);
  });

  it('does not make a global a dependency', () => {
    // a global never changes, so a value that reads one must not be woken by
    // it -- and the runtime would have to hand back a CoreValue for a dep
    // that can never fire
    const p = compile('<html :n=${1}><body><p>${Math.max(n, 2)}</p></body></html>');
    expect(p.errors).toStrictEqual([]);
    expect(textDeps(p)).toStrictEqual([{ key: 'n' }]);
  });

  it('lets a declared value shadow a global', () => {
    // resolution reaches the global scope only after walking the chain, so
    // the page's own name wins and is a real dependency
    const p = compile('<html :Math=${"mine"}><body><p>${Math}</p></body></html>');
    expect(p.errors).toStrictEqual([]);
    expect(textDeps(p)).toStrictEqual([{ key: 'Math' }]);
  });

  it('still reports a name that is neither declared nor a global', () => {
    const p = compile('<html><body><p>${Mathe.max(1, 2)}</p></body></html>');
    expect(p.errors.map(e => e.msg)).toStrictEqual(['Unknown reference: "Mathe"']);
  });

  it('does not treat a global name reached through a scope as global', () => {
    // `outer.Math` names a value on another scope; that it happens to spell a
    // global is irrelevant, and letting it through would hide a typo
    const p = compile(
      '<html><body><div :aka="outer"></div><p>${outer.Math}</p></body></html>'
    );
    expect(p.errors.map(e => e.msg)).toStrictEqual(['Unknown reference: "outer.Math"']);
  });

  it('resolves a global inside a handler body', () => {
    const p = compile(
      '<html><body><button :on-click=${() => console.log(Date.now())}></button></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
  });

  it('keeps the compiler list and the runtime list identical', () => {
    // the two are deliberately duplicated (the compiler doesn't depend on
    // runtime code); this is what stops them drifting apart. A name in one
    // list only is the worst case of both: the compiler accepting a
    // reference the runtime cannot resolve, or refusing one it could
    expect([...GLOBAL_NAMES].sort()).toStrictEqual([...GLOBAL_NAMES_RT].sort());
  });
});

// A callback's body is not a dependency of the value holding it -- that is
// deliberate, and stated where it is done. What it is NOT is a place where
// anything goes: a name that resolves to nothing is a typo, and left
// unchecked it compiles clean and then fails inside a handler nobody has run
// yet, which is how a whole component shipped broken.
describe('stage4-resolve: references inside callback bodies', () => {
  function compile(html: string) {
    const p = new Page(parse(html, 'test.html'));
    stage1load(p);
    stage2validate(p);
    stage3qualify(p);
    stage4resolve(p);
    return p;
  }

  function valueNamed(p: Page, name: string) {
    for (const [, v] of p.values) if (v.name === name) return v;
    return undefined;
  }

  it('reports an unknown reference in an :on- body', () => {
    const p = compile(
      '<html><body><button :on-click=${() => nope.open = true}></button></body></html>'
    );
    expect(p.errors.map(e => e.msg)).toStrictEqual(['Unknown reference: "nope"']);
  });

  it('reports an unknown reference in a :handle- body', () => {
    const p = compile(
      '<html><body :n=${1}><div :handle-n=${(v) => nope(v)}></div></body></html>'
    );
    expect(p.errors.map(e => e.msg)).toStrictEqual(['Unknown reference: "nope"']);
  });

  it('accepts a body that resolves, and still records no dependency for it', () => {
    // the point of the check is the error, not the dependency: a handler
    // must not re-run because something its body happens to touch changed
    const p = compile(
      '<html><body :n=${1} :other=${2}><button :on-click=${() => n = other}></button></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(valueNamed(p, 'on$click')!.deps).toStrictEqual([]);
  });

  it('leaves a :handle- depending on what it names and nothing in its body', () => {
    const p = compile(
      '<html><body :n=${1} :other=${2}><div :handle-n=${(v) => other}></div></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
    expect(valueNamed(p, 'handle$n')!.deps).toStrictEqual([{ key: 'n' }]);
  });

  it('does not complain about a computed access inside a body', () => {
    // that error is about a dependency this stage cannot follow, and a body
    // has no dependencies to follow -- so it would be a false alarm here
    const p = compile(
      '<html :k="count"><body><div :aka="outer" :count=${1}></div>' +
        '<button :on-click=${() => outer[k]}></button></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
  });
});
