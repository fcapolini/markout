import { describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { parse } from '../../src/html/parser';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { NodeType } from '../../src/html/dom';

// `:server-name=${expr}` means the expression runs on the server only and the
// client is handed its result. Here: that the compiler records the mark, and
// that it refuses the combinations where "server-only" means nothing.
// See docs/design/value-transfer.md.

function compile(html: string) {
  const p = new Page(parse(html, 'test.html'));
  stage1load(p);
  p.errors.length || stage2validate(p);
  p.errors.length || stage3qualify(p);
  p.errors.length || stage4resolve(p);
  p.errors.length || stage7generate(p);
  return p;
}

function bodyScripts(p: Page) {
  return p.source.doc.body!.childNodes.filter(
    (n: any) => n.nodeType === NodeType.ELEMENT && n.tagName === 'SCRIPT'
  ) as any[];
}

function value(p: Page, name: string) {
  return [...p.values.values()].find(v => v.name === name);
}

describe('stage1-load: :server-', () => {
  it('declares an ordinary value and marks it', () => {
    const p = compile('<html :server-t=${1}><body>${t}</body></html>');
    expect(p.errors).toStrictEqual([]);
    // the name is what it would be without the prefix: `:server-` is a
    // modifier, not a family, so `${t}` reads it as usual
    expect(value(p, 't')?.serverOnly).toBe(true);
  });

  it('leaves an unmarked value unmarked', () => {
    const p = compile('<html :t=${1}><body>${t}</body></html>');
    expect(p.errors).toStrictEqual([]);
    expect(value(p, 't')?.serverOnly).toBe(false);
  });

  it('composes with the _private naming convention', () => {
    const p = compile('<html :server-_raw=${1}><body>${_raw}</body></html>');
    expect(p.errors).toStrictEqual([]);
    expect(value(p, '_raw')?.serverOnly).toBe(true);
  });
});

describe('stage1-load: what :server- refuses', () => {
  it.each([
    ['attr-hidden', 'attr'],
    ['class-on', 'class'],
    ['style-color', 'style'],
    ['prop-items', 'prop'],
    ['on-click', 'on'],
    ['handle-x', 'handle'],
  ])('refuses :server-%s', spelling => {
    // the element-facing families derive from a value and re-derive on the
    // client for free once that value is marked; the callback ones hold
    // functions, which do not serialize
    const p = compile(`<html :x=\${1} :server-${spelling}=\${1}></html>`);
    expect(p.errors.map(e => e.msg).join('\n')).toMatch(/cannot be combined with/);
  });

  it.each(['did-init', 'will-dispose'])('refuses :server-%s', spelling => {
    const p = compile(`<html :server-${spelling}=\${() => 1}></html>`);
    expect(p.errors.map(e => e.msg).join('\n')).toMatch(/cannot be combined with/);
  });

  it.each(['aka', 'slot', 'for-each', 'for-data', 'for-as', 'for-key'])(
    'refuses :server-%s, which names no value',
    spelling => {
      const p = compile(`<html><body><div :server-${spelling}="x"></div></body></html>`);
      expect(p.errors.map(e => e.msg).join('\n')).toMatch(/is not a value/);
    }
  );
});

describe('stage7-generate: :server-', () => {
  it('emits the mark in the props', () => {
    const p = compile('<html :server-t=${1}><body>${t}</body></html>');
    expect(p.errors).toStrictEqual([]);
    expect(p.propsString).toMatch(/serverOnly:\s*true/);
  });

  it('reserves a state script for the server to fill', () => {
    const p = compile('<html :server-t=${1}><body>${t}</body></html>');
    const scripts = bodyScripts(p);
    // props, the reserved (still empty) state script, then the runtime
    expect(scripts).toHaveLength(3);
    expect(scripts[1]).toBe(p.stateScript);
    expect(scripts[2].getAttribute('src')).toBeTruthy();
  });

  it('reserves nothing on a page with no server-only value', () => {
    // a page that declares none should be byte-for-byte what it was before
    // this feature existed
    const p = compile('<html :t=${1}><body>${t}</body></html>');
    const scripts = bodyScripts(p);
    expect(scripts).toHaveLength(2);
    expect(p.stateScript).toBeUndefined();
  });
});
