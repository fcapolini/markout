import { assert, expect, it } from 'vitest';
import { parse } from '../../src/html/parser';
import { WebContext } from '../../src/runtime/web/web-context';
import { WebScope } from '../../src/runtime/web/web-scope';

it('should link element to scope', () => {
  const source = parse('<html data-markout="0"></html>', 'test');
  const context = new WebContext({
    doc: source.doc,
    root: { id: '0', values: {} },
  }).refresh();
  const root = context.root as WebScope;
  assert.equal(root.dom, source.doc.documentElement);
});

it('should update attribute', () => {
  const source = parse('<html data-markout="0"></html>', 'test');
  const context = new WebContext({
    doc: source.doc,
    root: { id: '0', values: { attr$lang: { val: 'en' } } },
  }).refresh();
  assert.equal(source.doc.documentElement?.getAttribute('lang'), 'en');
  context.root.proxy['attr$lang'] = 'it';
  assert.equal(source.doc.documentElement?.getAttribute('lang'), 'it');
});

it('should update class attribute', () => {
  const source = parse('<html data-markout="0"></html>', 'test');
  const context = new WebContext({
    doc: source.doc,
    root: {
      id: '0',
      values: {
        attr$class: { val: 'x' },
        class$y: { val: false },
      },
    },
  }).refresh();
  const e = source.doc.documentElement!;
  e.removeAttribute('data-markout');
  assert.equal(
    e.toString(),
    '<html class="x"><head></head><body></body></html>'
  );
  context.root.proxy.class$y = true;
  assert.equal(
    e.toString(),
    '<html class="x y"><head></head><body></body></html>'
  );
  context.root.proxy.class$y = false;
  assert.equal(
    e.toString(),
    '<html class="x"><head></head><body></body></html>'
  );
});

it('should update style attribute', () => {
  const source = parse('<html data-markout="0"></html>', 'test');
  const context = new WebContext({
    doc: source.doc,
    root: {
      id: '0',
      values: {
        attr$style: { val: 'margin: 0' },
        style$color: { val: 'red' },
      },
    },
  }).refresh();
  const e = source.doc.documentElement!;
  e.removeAttribute('data-markout');
  assert.equal(
    e.toString(),
    '<html style="margin: 0; color: red;"><head></head><body></body></html>'
  );
  context.root.proxy.style$color = 'blue';
  assert.equal(
    e.toString(),
    '<html style="margin: 0; color: blue;"><head></head><body></body></html>'
  );
  context.root.proxy.style$color = null;
  assert.equal(
    e.toString(),
    '<html style="margin: 0;"><head></head><body></body></html>'
  );
});

it('should update text', () => {
  const source = parse(
    '<html data-markout="0"><body>' +
      '<!---t0-->&#8203;<!---/--> <!---t1-->&#8203;<!---/-->!' +
      '</body></html>',
    'test'
  );
  const context = new WebContext({
    doc: source.doc,
    root: {
      id: '0',
      values: {
        text$0: { val: 'hello' },
        text$1: { val: 'there' },
      },
    },
  }).refresh();
  const e = source.doc.documentElement!;
  e.removeAttribute('data-markout');
  assert.equal(
    e.toString(),
    '<html><head></head><body>' +
      '<!---t0-->hello<!---/--> <!---t1-->there<!---/-->!' +
      '</body></html>'
  );
  context.root.proxy.text$0 = 'hi';
  assert.equal(
    e.toString(),
    '<html><head></head><body>' +
      '<!---t0-->hi<!---/--> <!---t1-->there<!---/-->!' +
      '</body></html>'
  );
  context.root.proxy.text$1 = 'folks';
  assert.equal(
    e.toString(),
    '<html><head></head><body>' +
      '<!---t0-->hi<!---/--> <!---t1-->folks<!---/-->!' +
      '</body></html>'
  );
});
