import { assert, describe, it } from 'vitest';
import { parse } from '../../src/html/parser';

/**
 * These tests state the escaping *rules* rather than pinning examples, so a
 * new element class can't quietly pick up the wrong behaviour.
 *
 * - raw text (script, style): entities are neither decoded on parse nor
 *   emitted on serialization — browsers don't decode them either
 * - escapable raw text (title): entities are decoded and re-emitted
 * - normal elements: same as escapable raw text
 * - attribute values: `&`, `<` and the quote character are escaped
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
