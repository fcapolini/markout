import { describe, expect, it } from 'vitest';
import { parse } from '../../src/html/parser';
import { Page } from '../../src/compiler/ir/Page';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';

/**
 * A page writing a value the user can take away from it.
 *
 * `value=${v}` reads as "this is the value" and behaves as "this was the
 * initial value": from the first keystroke HTML's dirty-value flag makes the
 * element's own value independent of both the attribute and the content, so
 * `v = ''` after a submit empties the model and leaves the typed text on
 * screen. It compiled clean, ran clean, and this project shipped it in
 * `bs-input` -- which is why the warning is here rather than only in the
 * documentation.
 */
function warnings(body: string): string[] {
  const page = new Page(parse(`<html><body :v=\${1}>${body}</body></html>`, 'test.html'));
  stage1load(page);
  stage2validate(page);
  // the page still builds: this is a judgment about it, not a fact about
  // whether it can be served
  expect(page.hasErrors).toBe(false);
  return page.errors.filter(e => e.type === 'warning').map(e => e.msg);
}

describe('the attributes HTML gives a dirty flag to', () => {
  it('warns about a bound value on an input', () => {
    expect(warnings('<input value=${v}>')).toStrictEqual([
      '<input> keeps its own "value" once the user has changed it, so this ' +
        'stops showing -- did you mean to add ":prop-value=" beside it?',
    ]);
  });

  it('warns about a bound value in a textarea, written either way', () => {
    expect(warnings('<textarea value=${v}></textarea>')).toHaveLength(1);
    // the spelling most people reach for, and the one a scope walk alone
    // cannot see: a text interpolation gives its element no scope
    expect(warnings('<textarea>${v}</textarea>')).toStrictEqual([
      '<textarea> keeps its own "value" once the user has changed it, so this ' +
        'stops showing -- did you mean to add ":prop-value=" on the tag?',
    ]);
  });

  it('warns about checked and selected, in both spellings', () => {
    // `checked=${v}` sets what the attribute says, `:attr-checked=${v}` sets
    // whether it is there at all, and the flag defeats each of them the same
    expect(warnings('<input type="checkbox" checked=${v}>')).toHaveLength(1);
    expect(warnings('<input type="checkbox" :attr-checked=${v}>')).toHaveLength(1);
    expect(warnings('<select><option selected=${v}>a</option></select>')).toHaveLength(1);
    expect(warnings('<select><option :attr-selected=${v}>a</option></select>')).toHaveLength(1);
  });

  it('says nothing when the property is bound beside the attribute', () => {
    // the pair is the fix: the attribute is what the element is SERVED with,
    // which a hydrating page still needs, and the property is what it shows
    expect(warnings('<input value=${v} :prop-value=${v}>')).toStrictEqual([]);
    expect(warnings('<textarea :prop-value=${v}>${v}</textarea>')).toStrictEqual([]);
    expect(warnings('<input type="checkbox" :attr-checked=${v} :prop-checked=${v}>')).toStrictEqual(
      []
    );
  });

  it('says nothing about an input type with nothing to dirty', () => {
    // `value` on these is a label or data the page put there; HTML's
    // "default" mode of operation reflects the attribute for as long as the
    // element exists, so writing the attribute is exactly right
    expect(warnings('<input type="submit" value=${v}>')).toStrictEqual([]);
    expect(warnings('<input type="hidden" value=${v}>')).toStrictEqual([]);
    expect(warnings('<input type="BUTTON" value=${v}>')).toStrictEqual([]);
  });

  it('says nothing about a computed type', () => {
    // Tried the other way first, and the kit refused it: `bs-check` writes
    // `type=${_type}` over checkbox/radio/switch, where `value` is what the
    // control SUBMITS -- so the warning fired twice on correct code, and
    // `:prop-value` would have been wrong advice. An unknown gets silence,
    // because a warning nobody can act on is worse than the case it catches
    expect(warnings('<input type=${"text"} value=${v}>')).toStrictEqual([]);
  });

  it('says nothing about an attribute with no flag', () => {
    expect(warnings('<input type="text" placeholder=${v}>')).toStrictEqual([]);
    expect(warnings('<input type="text" :attr-required=${v}>')).toStrictEqual([]);
    expect(warnings('<div value=${v}>x</div>')).toStrictEqual([]);
  });
});

describe('what a control type decides', () => {
  it('says nothing about the value a checkbox or a radio submits', () => {
    // `value` there is what the control SUBMITS, not what is typed in it --
    // HTML's "default/on" mode, which reflects the attribute for as long as
    // the element exists. Caught by `bs-check`, which binds exactly this
    expect(warnings('<input type="checkbox" value=${v}>')).toStrictEqual([]);
    expect(warnings('<input type="radio" value=${v}>')).toStrictEqual([]);
  });

  it('still warns about checked on the same control', () => {
    // the two attributes are not the same question: what it submits is the
    // page's, whether it is ticked is the user's
    expect(warnings('<input type="checkbox" value=${v} :attr-checked=${v}>')).toHaveLength(1);
  });

  it('says nothing about a file input, whose value it cannot set anyway', () => {
    expect(warnings('<input type="file" value=${v}>')).toStrictEqual([]);
  });

  it('warns about the value modes that are typed in', () => {
    expect(warnings('<input type="text" value=${v}>')).toHaveLength(1);
    expect(warnings('<input type="date" value=${v}>')).toHaveLength(1);
    expect(warnings('<input type="range" value=${v}>')).toHaveLength(1);
  });
});
