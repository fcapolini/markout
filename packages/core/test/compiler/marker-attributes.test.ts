import { describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { parse } from '../../src/html/parser';

/**
 * Attributes on the two tags that are not elements.
 *
 * `<:slot>` and `<:group>` both stop existing before anything renders --
 * one is replaced by the caller's markup, the other is spliced into its
 * parent -- so an attribute written on either goes with the tag. That was
 * three different failures for one mistake, depending on which attribute:
 *
 * - `:if` and `:else` on a slot moved the marker into a stencil and then
 *   crashed `adoptSlottedScopes` with `owner.getAttribute is not a
 *   function`, walking up from the slot's host into a `<template>`'s
 *   content fragment;
 * - `:for-each` crashed elsewhere on the same shape (`removeChild` of
 *   null);
 * - everything else -- `:aka`, `:class-`, `:on-`, plain values -- compiled
 *   clean and did nothing, which is the worst of the three: the attribute
 *   reads as applying to the content.
 *
 * `<:group>` had the same silence and now has rules of its own; those are
 * in group-attributes.test.ts.
 *
 * All of them are now the same message, and the compile survives to report
 * whatever else is wrong. Supporting rather than refusing them means a
 * region with several nodes and no element of its own, which is
 * docs/design/group-regions.md.
 */
function errors(html: string): string[] {
  const page = new Page(parse(html, 'markers.html'));
  page.errors = page.source.errors;
  page.errors.length || stage1load(page);
  return page.errors.map(e => e.msg);
}

const define = (slotAttrs: string) =>
  '<html><head><:define tag="my-box:div" ::ok=${true}>' +
  `<:slot ${slotAttrs} />` +
  '</:define></head><body><my-box>CONTENT</my-box></body></html>';

describe('a <:slot> carrying anything but "name"', () => {
  // the two that used to take the compiler down rather than report
  it.each([':if=${ok}', ':else', ':for-each=${[1, 2]}'])(
    'reports %s instead of crashing',
    attr => {
      const found = errors(define(attr));
      expect(found.join()).toMatch(/<:slot> takes only "name"/);
      expect(found.join()).toMatch(/Put it on an element around the <:slot>/);
    }
  );

  // and the ones that were silent, which is the same mistake read as working
  it.each([':aka="s"', ':class-x=${ok}', ':on-click=${() => 0}', ':v=${1}'])(
    'reports %s, which used to compile clean and do nothing',
    attr => {
      expect(errors(define(attr)).join()).toMatch(/<:slot> takes only "name"/);
    }
  );

  it('names the attribute that is wrong', () => {
    expect(errors(define(':class-x=${ok}')).join()).toMatch(/":class-x" here/);
  });

  it('leaves a plain slot and a named one alone', () => {
    expect(errors(define(''))).toStrictEqual([]);
    expect(errors(define('name="main"')).join()).not.toMatch(/takes only/);
  });
});
