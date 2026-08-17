import { assert, describe, it } from 'vitest';
import { parse } from '../../src/html/parser';
import { NodeType } from '../../src/html/dom';

/**
 * These tests state the escaping *rules* rather than pinning examples, so a
 * new element class can't quietly pick up the wrong behaviour.
 *
 * - raw text (script, style): entities are neither decoded on parse nor
 *   emitted on serialization — browsers don't decode them either
 * - escapable raw text (title): entities are decoded and re-emitted
 * - normal elements: same as escapable raw text
 * - attribute values: `&`, `<` and the quote character are escaped
 *
 * Decoding covers the whole HTML5 character-reference set, and follows the
 * spec's split between the two contexts: in text a legacy reference decodes
 * even without its semicolon (`&notit;` is `¬it;`), while in an attribute it
 * does not — which is what keeps `?a=1&copy=2` from becoming `?a=1©=2`.
 */

function docFor(tag: string, content: string): string {
  const inHead = tag === 'title' || tag === 'style';
  const markup = `<${tag}>${content}</${tag}>`;
  return inHead
    ? `<html><head>${markup}</head><body></body></html>`
    : `<html><head></head><body>${markup}</body></html>`;
}

function serialize(src: string): string {
  const source = parse(src, 'test');
  assert.deepEqual(
    source.errors.map(e => e.msg),
    [],
    `unexpected errors for: ${src}`
  );
  return source.doc!.toString();
}

function contentOf(tag: string, markup: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*)</${tag}>`).exec(markup);
  assert.isNotNull(m, `no <${tag}> in ${markup}`);
  return m![1];
}

const RAW_TEXT_TAGS = ['script', 'style'];
const ESCAPED_TEXT_TAGS = ['title', 'p', 'div', 'code'];

describe('raw text elements', () => {
  RAW_TEXT_TAGS.forEach(tag => {
    it(`<${tag}> content is emitted verbatim`, () => {
      // `<` would end the element, so it isn't part of the payload here
      const content = 'a && b > c &amp; d &lt; e';
      const out = serialize(docFor(tag, content));
      assert.equal(contentOf(tag, out), content);
    });

    it(`<${tag}> content is not entity-decoded`, () => {
      const out = serialize(docFor(tag, '&amp;'));
      assert.equal(contentOf(tag, out), '&amp;');
    });
  });
});

describe('escaped text elements', () => {
  ESCAPED_TEXT_TAGS.forEach(tag => {
    it(`<${tag}> content escapes & and <`, () => {
      const out = serialize(docFor(tag, 'a & b'));
      assert.equal(contentOf(tag, out), 'a &amp; b');
    });

    it(`<${tag}> content decodes entities, then re-escapes them`, () => {
      const out = serialize(docFor(tag, 'a &amp; b &lt; c'));
      assert.equal(contentOf(tag, out), 'a &amp; b &lt; c');
    });

    it(`<${tag}> content keeps double encoding stable`, () => {
      const out = serialize(docFor(tag, 'a &amp;amp; b'));
      assert.equal(contentOf(tag, out), 'a &amp;amp; b');
    });
  });
});

describe('interpolated content', () => {
  // <style> and <title> interpolate `${...}`; the text node then holds an
  // expression the runtime fills in later. Escaping must follow the element,
  // not whether the content happens to contain an expression — otherwise a
  // generated stylesheet comes out as `a &gt; b`, which browsers won't decode.
  function textNodeOf(tag: string, content: string) {
    const source = parse(docFor(tag, content), 'test');
    assert.deepEqual(
      source.errors.map(e => e.msg),
      []
    );
    const el =
      tag === 'title' || tag === 'style'
        ? (source.doc!.documentElement!.childNodes[0] as any).childNodes[0]
        : (source.doc!.documentElement!.childNodes[1] as any).childNodes[0];
    return el.childNodes[0];
  }

  it('<style> keeps interpolated content raw', () => {
    const node = textNodeOf('style', '${css}');
    node.textContent = 'a > b { content: "&" }';
    assert.equal(node.toString(), 'a > b { content: "&" }');
  });

  it('<title> escapes interpolated content', () => {
    const node = textNodeOf('title', '${title}');
    node.textContent = 'a > b & c';
    assert.equal(node.toString(), 'a &gt; b &amp; c');
  });

  it('<style> keeps static content raw', () => {
    const out = serialize(docFor('style', 'a > b { content: "&" }'));
    assert.equal(contentOf('style', out), 'a > b { content: "&" }');
  });
});

describe('numeric character references', () => {
  // these are decoded on parse, so they survive serialization as characters.
  // if they didn't, escaping `&` would turn them into literal `&#8203;` text
  ESCAPED_TEXT_TAGS.forEach(tag => {
    it(`<${tag}> decodes decimal references`, () => {
      const out = serialize(docFor(tag, 'a&#8203;b'));
      assert.equal(contentOf(tag, out), 'a​b');
    });

    it(`<${tag}> decodes hex references`, () => {
      const out = serialize(docFor(tag, 'a&#x200B;b'));
      assert.equal(contentOf(tag, out), 'a​b');
    });
  });

  it('keeps an escaped reference literal', () => {
    // `&amp;#8203;` is the text "&#8203;", not a zero-width space
    const out = serialize(docFor('p', 'a&amp;#8203;b'));
    assert.equal(contentOf('p', out), 'a&amp;#8203;b');
  });

  it('decodes references in attribute values', () => {
    const out = serialize(`<html a="x&#8203;y"></html>`);
    assert.include(out, 'a="x​y"');
  });
});

describe('named character references', () => {
  // the whole HTML5 set, not a hand-kept subset: an undecoded reference
  // reaches the page as literal `&amp;nbsp;` text, so every name a page
  // author can reasonably write has to resolve to its character
  ESCAPED_TEXT_TAGS.forEach(tag => {
    it(`<${tag}> decodes names beyond the markup-critical few`, () => {
      const out = serialize(docFor(tag, 'a&nbsp;b&mdash;c&uarr;d'));
      assert.equal(contentOf(tag, out), 'a b—c↑d');
    });
  });

  it('leaves an unknown name alone, rather than guessing', () => {
    const out = serialize(docFor('p', 'a&zzz;b'));
    assert.equal(contentOf('p', out), 'a&amp;zzz;b');
  });

  it('applies the legacy no-semicolon rule in text, as a browser does', () => {
    // the HTML5 spec's own example: `&notit;` is `&not` followed by `it;`,
    // because a handful of old references decode without their semicolon.
    // Surprising, but matching the browser is the whole point -- markout
    // serializes this back out for a browser to re-parse
    const out = serialize(docFor('p', '&notit;'));
    assert.equal(contentOf('p', out), '¬it;');
  });

  it('does NOT apply that rule in an attribute, which is why URLs survive', () => {
    const out = serialize(`<html a="&notit;"></html>`);
    assert.include(out, 'a="&amp;notit;"');
  });

  it('keeps an escaped name literal', () => {
    // `&amp;nbsp;` is the text "&nbsp;", not a non-breaking space -- decoding
    // is one left-to-right pass, so it never re-reads its own output
    const out = serialize(docFor('p', 'a&amp;nbsp;b'));
    assert.equal(contentOf('p', out), 'a&amp;nbsp;b');
  });

  it('decodes them in attribute values too', () => {
    const out = serialize(`<html a="x&nbsp;y"></html>`);
    assert.include(out, 'a="x y"');
  });

  it('leaves a semicolon-less reference alone in an attribute, keeping URLs intact', () => {
    // the rule that makes attributes decode LESS than text: `&copy=2` in a
    // query string must stay put. Decoding it would rewrite a working link
    // into `?a=1©=2`
    const out = serialize(`<html a="?a=1&copy=2&sort=x"></html>`);
    assert.include(out, 'a="?a=1&amp;copy=2&amp;sort=x"');
  });

  it('still decodes one that does carry its semicolon, in an attribute', () => {
    const out = serialize(`<html a="?a=1&copy;=2"></html>`);
    assert.include(out, 'a="?a=1©=2"');
  });
});

describe('attribute values', () => {
  it('escapes &, < and the quote character', () => {
    const out = serialize(`<html a="x & y < z &quot;q&quot;"></html>`);
    assert.include(out, `a="x &amp; y &lt; z &quot;q&quot;"`);
  });

  it('decodes entities, then re-escapes them', () => {
    const out = serialize(`<html a="&amp; &lt; &apos;"></html>`);
    assert.include(out, `a="&amp; &lt; '"`);
  });
});

describe('serialization', () => {
  const SAMPLES = [
    '<html><body><p>a &amp; b</p></body></html>',
    '<html><head><title>a &amp; b</title></head><body></body></html>',
    '<html><head><style>a & b</style></head><body></body></html>',
    '<html><body><script>a && b</script></body></html>',
    '<html a="&amp; &lt;"><head></head><body></body></html>',
    '<html><body><div style="color:red">x</div></body></html>',
  ];

  SAMPLES.forEach(sample => {
    it(`is idempotent for ${sample}`, () => {
      const once = serialize(sample);
      const twice = serialize(once);
      assert.equal(twice, once);
    });
  });
});

/**
 * HTML's raw text and escapable raw text elements hold text, not markup: a
 * browser reads to the closing tag without ever looking for another one
 * (spec 13.2.5.1). These used to be parsed as markup, so a stylesheet could
 * not say `<template>` in a comment -- it reported a tag nobody wrote, and
 * the page 500'd -- and a `<textarea>` showing example markup got real
 * elements inside it.
 */
/** the first element with this tag, anywhere in the tree */
function firstTag(node: any, tag: string): any {
  if (node.tagName === tag) return node;
  for (const c of node.childNodes ?? []) {
    const found = firstTag(c, tag);
    if (found) return found;
  }
  return undefined;
}

describe('text-holding elements contain no markup', () => {
  const CASES: [string, string][] = [
    ['a tag name in a CSS comment', '/* see <template> */ p { color: red }'],
    ['a tag in a content string', 'p::before { content: "<b>" }'],
    ['a bare < in a selector', 'a<b { color: red }'],
  ];

  CASES.forEach(([what, css]) => {
    it(`<style> parses ${what} as text`, () => {
      const html = `<html><head><style>${css}</style></head><body>x</body></html>`;
      // raw text: what went in is what comes out, entities and all
      // (serialize() also asserts the parse reported nothing)
      assert.equal(contentOf('style', serialize(html)), css);
    });
  });

  it('<textarea> keeps markup as text rather than elements', () => {
    const html = '<html><body><textarea>a <b>x</b> c</textarea></body></html>';
    const src = parse(html, 't');
    assert.deepEqual(src.errors.map(e => e.msg), []);
    const ta = firstTag(src.doc, 'TEXTAREA');
    assert.deepEqual(
      ta.childNodes.map((n: any) => n.nodeType),
      [NodeType.TEXT],
      'a browser has no <b> element in here'
    );
    // escapable raw text: serialized back with `<` escaped, so re-reading it
    // cannot turn the payload into a tag
    assert.equal(contentOf('textarea', serialize(html)), 'a &lt;b&gt;x&lt;/b&gt; c');
  });

  it('<title> does the same', () => {
    const src = parse('<html><head><title>a <b>x</b></title></head><body>y</body></html>', 't');
    assert.deepEqual(src.errors.map(e => e.msg), []);
    const t = firstTag(src.doc, 'TITLE');
    assert.deepEqual(t.childNodes.map((n: any) => n.nodeType), [NodeType.TEXT]);
  });

  it('still interpolates, which is what a reactive stylesheet needs', () => {
    const src = parse(
      '<html :c=${"red"}><head><style>p { color: ${c} }</style></head><body>x</body></html>',
      't'
    );
    assert.deepEqual(src.errors.map(e => e.msg), []);
    const style = firstTag(src.doc, 'STYLE');
    // one node holding the whole thing, expression included -- see
    // ATOMIC_TEXT_TAGS on why it cannot be split
    assert.equal(style.childNodes.length, 1);
    assert.notEqual(typeof style.childNodes[0].textContent, 'string');
  });

  it('reports an unterminated one rather than swallowing the page', () => {
    const src = parse('<html><head><style>p { color: red }</head><body>x</body></html>', 't');
    assert.match(src.errors.map(e => e.msg).join(), /Unterminated/);
  });
});
