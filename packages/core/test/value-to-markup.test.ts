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
 * What a value may and may not become when it reaches the markup.
 *
 * The neighbouring question to [code-execution.md](../../../docs/design/code-execution.md):
 * that one is about whose JavaScript runs where, this one about whether a
 * string can stop being a string. `docs/design/value-to-markup.md` is the
 * prose; these are the surfaces it enumerates, one test each, so that the
 * page cannot go stale without something failing.
 *
 * The guarantee is structural rather than a filter. `${...}` is parsed with
 * Acorn and the code generated from the AST, so a value is never spliced
 * into a string of markup and re-parsed: it arrives at a text node, an
 * attribute or a CSS property, and the serializer escapes for the one place
 * it landed. There is no sanitizer to bypass because there is no reparse to
 * bypass it with.
 *
 * TWO of these tests pin a LIMIT rather than a guarantee -- the `<style>`
 * body and the `style+=` map. They assert what currently happens, which is
 * injection, so a change that closes either one fails here and sends
 * whoever made it to the doc. Do not "fix" the expectation: fix the doc with
 * it, or the page goes on warning about something that no longer happens.
 */

const HOSTILE = '</script><script>alert(1)</script><!--';

function render(html: string) {
  const page = new Page(parse(html, 'v2m.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  const errors: string[] = [];
  new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: e => errors.push(`${e.phase}/${e.key}: ${e.message}`),
  }).refresh();
  expect(errors).toStrictEqual([]);
  return page.source.doc.toString();
}

/**
 * The served markup with markout's own three `<script>`s taken out.
 *
 * They hold the page's compiled expressions -- the author's code, not a
 * visitor's data -- and they carry `<` legitimately, so leaving them in
 * would make every "emits no `<`" assertion below vacuously false. What
 * crosses in them is covered by render/serialize.test.ts, which is where the
 * state blob's escaper is pinned against this same payload.
 */
function body(html: string) {
  const out = render(html);
  return out
    .slice(out.indexOf('<body'))
    .replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')
    .replace(/<script>window\.__MARKOUT_PROPS[\s\S]*?<\/script>/, '')
    .replace(/<script src="\/markout-runtime\.js" async><\/script>/, '');
}

describe('a value in text', () => {
  it('cannot open a tag', () => {
    const out = body(`<html><body :v=\${'${HOSTILE}'}><p>\${v}</p></body></html>`);
    expect(out).toContain('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toMatch(/<script>alert/);
  });

  it('escapes `&` as well, so an entity cannot be smuggled through it', () => {
    // `&lt;img&gt;` arriving as data must render as that text and not as the
    // tag it names -- which takes escaping the ampersand, not just `<`
    expect(body(`<html><body :v=\${'&lt;img&gt;'}><p>\${v}</p></body></html>`)).toContain(
      '&amp;lt;img&amp;gt;'
    );
  });
});

describe('a value in an attribute', () => {
  it('cannot end the attribute and add another', () => {
    const out = body(
      `<html><body :v=\${'x" onerror="alert(1)'}><img src="\${v}"></body></html>`
    );
    expect(out).toContain('src="x&quot; onerror=&quot;alert(1)"');
    // the payload's own text says `onerror=`, so the property worth
    // asserting is that it is never followed by a real quote: the attribute
    // it would have opened does not exist
    expect(out).not.toMatch(/onerror="/);
  });

  it('is quoted on output however it was written in the source', () => {
    // the source has no quotes around this one; the serializer adds them, so
    // a value holding a space cannot become a second attribute
    const out = body(
      `<html><body :v=\${'a onmouseover=alert(1)'}><p title=\${v}>x</p></body></html>`
    );
    expect(out).toContain('title="a onmouseover=alert(1)"');
  });

  it('cannot open a tag from inside an attribute', () => {
    expect(body(`<html><body :v=\${'${HOSTILE}'}><p title="\${v}">x</p></body></html>`)).not.toContain(
      '<script'
    );
  });
});

describe('a value in RCDATA', () => {
  it('cannot close a `<title>`', () => {
    const out = render(
      `<html :v=\${'</title><script>alert(1)</script>'}>` +
        '<head><title>${v}</title></head><body></body></html>'
    );
    expect(out).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>');
  });
});

describe('a value in class and style', () => {
  it('cannot break out of `class`', () => {
    const out = body(
      `<html><body :v=\${['a" onload="alert(1)']}><p class+=\${v}>x</p></body></html>`
    );
    expect(out).toContain('class="a&quot; onload=&quot;alert(1)"');
  });

  it('cannot break out of the `style` attribute', () => {
    const out = body(
      `<html><body :v=\${'red" onload="alert(1)'}><p style="color: \${v}">x</p></body></html>`
    );
    expect(out).toContain('style="color: red&quot; onload=&quot;alert(1);"');
    expect(out).not.toMatch(/onload="/);
  });
});

describe('`<script>` is not an interpolation surface', () => {
  it('leaves `${...}` in a script body alone', () => {
    // RAW_TEXT_TAGS, and the reason a page cannot accidentally compile a
    // value into its own JavaScript: there is nothing to compile it into
    expect(body('<html><body :v=${1}><script>var x = ${v};</script></body></html>')).toContain(
      'var x = ${v};'
    );
  });
});

describe('the two limits', () => {
  /**
   * A stylesheet holds TEXT, and per the HTML spec its text may not be
   * escaped -- `&` and `<` are literal in CSS, so escaping a static
   * stylesheet would corrupt it. `escaping` is therefore off for the whole
   * element ([parser.ts](../src/html/parser.ts), RAW_TEXT_TAGS), and an
   * interpolated value inherits that: it is spliced raw.
   *
   * Which makes this the one surface on the page where a value can become
   * markup, and it is a rendered-markup vector only -- on the client the
   * same binding is a `textContent` write, and `textContent` on a `<style>`
   * parses CSS and never HTML.
   */
  it('a value in a `<style>` body IS spliced raw, closing tag and all', () => {
    const out = render(
      `<html :v=\${'red } </style><script>alert(1)</script>'}>` +
        '<head><style>.a { color: ${v} }</style></head><body></body></html>'
    );
    expect(out).toContain('</style><script>alert(1)</script>');
  });

  /**
   * A CSS value carrying `;` becomes two declarations, on all three of the
   * surfaces that take one: the server's `setProperty`
   * ([server-dom.ts](../src/html/server-dom.ts), `ServerStyleProp`) stores
   * whatever it is given, and `cssText` writes each pair as `key: val;`
   * without asking whether the value is a single declaration.
   *
   * The browser's own `setProperty` rejects a value holding `;`, so this
   * lands in the served markup and is dropped on hydration -- CSS injection
   * plus a divergence, and no script either way.
   *
   * All three asserted, because "use the other one instead" is the advice a
   * reader would otherwise draw from seeing only one of them fail.
   */
  const INJECTING = 'red; background: url(//evil.test/x)';
  const BOTH = 'style="color: red; background: url(//evil.test/x);"';

  it('a `style+=` map value carrying `;` becomes two declarations', () => {
    expect(
      body(`<html><body :v=\${'${INJECTING}'}><p style+=\${{ color: v }}>x</p></body></html>`)
    ).toContain(BOTH);
  });

  it('so does an interpolation in the `style` attribute', () => {
    expect(
      body(`<html><body :v=\${'${INJECTING}'}><p style="color: \${v}">x</p></body></html>`)
    ).toContain(BOTH);
  });

  it('so does `:style-name`', () => {
    expect(
      body(`<html><body :v=\${'${INJECTING}'}><p :style-color=\${v}>x</p></body></html>`)
    ).toContain(BOTH);
  });
});

describe('what is deliberately not filtered', () => {
  /**
   * As in React, Vue and Svelte: a URL is a string, and which schemes an
   * application permits is the application's question. Asserted so the doc's
   * caveat is not describing something that quietly changed.
   */
  it('a `javascript:` URL passes through `href`', () => {
    expect(body(`<html><body :v=\${'javascript:alert(1)'}><a href="\${v}">x</a></body></html>`)).toContain(
      'href="javascript:alert(1)"'
    );
  });
});
