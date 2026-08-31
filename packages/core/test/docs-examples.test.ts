import { describe, expect, it } from 'vitest';
import { Page } from '../src/compiler/ir/Page';
import { stage1load } from '../src/compiler/stages/stage1-load';
import { stage2validate } from '../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../src/compiler/stages/stage7-generate';
import { parse } from '../src/html/parser';
import { renderPage } from '../src/render/render';
import { WebContext } from '../src/runtime/web/web-context';
import { loadProps } from '../src/render/props';

// Every example in docs/ that a reader would type in, compiled and rendered.
// Documentation that doesn't run is worse than none: it costs the reader the
// time to find out, and it is exactly what goes stale first.

async function render(html: string) {
  const page = new Page(parse(html, 'docs.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  const runtimeErrors = page.errors.length ? [] : await renderPage(page);
  const markup = page.source.doc.toString();
  const strip = (s: string) =>
    s.replace(/<!--.*?-->/g, '').replace(/ data-markout="[^"]*"/g, '');
  return {
    errors: page.errors,
    runtimeErrors,
    body: strip(markup.slice(markup.indexOf('<body'), markup.indexOf('<script'))),
    // the head as well, for an example whose point is that one value
    // reaches both halves of a page
    head: strip(markup.slice(markup.indexOf('<head'), markup.indexOf('</head>'))),
  };
}

function expectClean(result: Awaited<ReturnType<typeof render>>) {
  expect(result.errors).toStrictEqual([]);
  expect(result.runtimeErrors).toStrictEqual([]);
}

describe('docs/concepts/values.md', () => {
  it('renders the interpolated-attribute example', async () => {
    const result = await render(
      '<html :section=${{ id: "top", title: "Top" }}><body>' +
        "<a href=${'#' + section.id} aria-label=${'Go to ' + section.title}>x</a>" +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('href="#top"');
    expect(result.body).toContain('aria-label="Go to Top"');
  });

  it('renders the presence-not-value example', async () => {
    const result = await render(
      '<html :isOpen=${false} :canSubmit=${false}><body>' +
        '<sl-dialog :attr-open=${isOpen}>x</sl-dialog>' +
        '<button :attr-disabled=${!canSubmit}>Send</button>' +
        '<input :attr-required>' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).not.toContain('open');
    expect(result.body).toContain('disabled=""');
    expect(result.body).toContain('required=""');
  });

  it('removes an attribute whose expression is null', async () => {
    const result = await render(
      '<html :count=${0}><body>' +
        "<b title=${count > 0 ? 'yes' : null}>x</b>" +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).not.toContain('title');
  });
});

describe('docs/reference/syntax.md', () => {
  // the table under "Attribute values and quoting": quoting doesn't decide
  // the type, filling the value on its own does
  function compile(html: string) {
    const page = new Page(parse(html, 'docs.html'));
    stage1load(page);
    stage2validate(page);
    stage3qualify(page);
    stage4resolve(page);
    stage7generate(page);
    return page;
  }

  function valuesOf(html: string) {
    const page = compile(html);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const ctx = new WebContext({
      ...loadProps(page.props!),
      doc: page.source.doc,
      server: true,
      onError: e => {
        throw new Error(e.message);
      },
    }).refresh();
    return ctx.root.proxy;
  }

  it('keeps the type of an expression that fills the value, quoted or not', async () => {
    const v = valuesOf(
      '<html :bare=${{ a: 1 }} :dq="${{ a: 1 }}" :sq=\'${{ a: 1 }}\'' +
        ' :num=${42} :dqNum="${42}"></html>'
    );
    expect(v['bare']).toStrictEqual({ a: 1 });
    expect(v['dq']).toStrictEqual({ a: 1 });
    expect(v['sq']).toStrictEqual({ a: 1 });
    expect(v['num']).toBe(42);
    expect(v['dqNum']).toBe(42);
  });

  it('interpolates to a string once anything else is in the value', async () => {
    const v = valuesOf(
      '<html :mixed="n=${1}" :two="${1}${2}" :spaced=" ${1}"' +
        ' :plain="literal"></html>'
    );
    expect(v['mixed']).toBe('n=1');
    expect(v['two']).toBe('12');
    // whitespace is literal text like any other
    expect(v['spaced']).toBe(' 1');
    expect(v['plain']).toBe('literal');
  });

  it('takes a literal arrow for callbacks, and nothing else', async () => {
    // the yes/error block under the binding table. Covered per-rule in
    // stage2-validate.test.ts against hand-built values; this checks the
    // documented markup itself, including the lifecycle families
    const ok = (body: string) =>
      compile(`<html :count=\${0} :handler=\${() => 1}><body>${body}</body></html>`)
        .errors.map(e => e.msg);

    expect(ok('<b :on-click=${() => count++}>x</b>')).toStrictEqual([]);
    expect(ok('<b :on-click=${async () => { await count; }}>x</b>')).toStrictEqual([]);
    expect(ok('<b :did-init=${() => count++}>x</b>')).toStrictEqual([]);

    // a callback has to BE a function, written here, because that is where
    // its dependencies are read from -- naming one is not being one
    for (const bad of [
      '<b :on-click=${handler}>x</b>',
      '<b :did-init=${handler}>x</b>',
      '<b :will-dispose=${handler}>x</b>',
    ]) {
      expect(ok(bad).join(' ')).toContain('must be a function written here');
    }

    // a classic one is a function written here, and is taken: it used to be
    // refused because it rebinds `this`, and an expression reaches its scope
    // through a parameter now
    expect(ok('<b :on-click=${function () {}}>x</b>')).toStrictEqual([]);
    expect(ok('<b :x=${() => { const f = function () {}; return f; }}>x</b>')).toStrictEqual([]);

    // what a page may not do is take the name the scope arrives under
    expect(ok('<b :x=${() => [1].map($ => $)}>x</b>').join(' '))
      .toContain('reaches its scope');
  });

  it('passes an array through :prop- when the expression fills the value', async () => {
    const page = compile(
      '<html :items=${["a", "b"]}><body>' +
        '<sl-select :prop-options="${items}" :prop-label="one of ${items.length}">' +
        '</sl-select></body></html>'
    );
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const ctx = new WebContext({
      ...loadProps(page.props!),
      doc: page.source.doc,
      onError: e => {
        throw new Error(e.message);
      },
    }).refresh();
    const select = ctx.root.children[1].children[0] as any;
    expect(select.dom.options).toStrictEqual(['a', 'b']);
    expect(select.dom.label).toBe('one of 2');
  });

  it('renders the commented, multi-line opening tag', async () => {
    // written exactly as the section shows it, newlines and all: what makes
    // the shape usable is that attributes may span lines AND be annotated,
    // so the test would be worthless collapsed onto one
    const result = await render(
      '<html><body>\n' +
        '<div class="my-component"\n' +
        '\n' +
        '     // parameters\n' +
        '     :width=${100}\n' +
        '\n' +
        '     // private\n' +
        '     :_w="${width}px"\n' +
        '\n' +
        '>${_w}</div>\n' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('100px');
    // stripped at parse time: neither comment reaches the served markup
    expect(result.body).not.toContain('//');
    expect(result.body).not.toContain('parameters');
  });

  it('hides a single attribute behind a comment, as code does', async () => {
    const result = await render(
      '<html><body><div class="x"\n' +
        '  // :width=${100}\n' +
        '  :height=${20}\n' +
        '>${height}</div></body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('20');
  });

  it('runs an unterminated comment to EOF, surfacing as an unclosed tag', async () => {
    // the diagnostic names the tag, not the comment -- worth stating in the
    // docs, because the message points somewhere other than the mistake
    const source = parse(
      '<html><body><div\n  /* never closed\n  :x=${1}\n></div></body></html>',
      'docs.html'
    );
    expect(source.errors.map(e => e.msg)).toStrictEqual(['Unterminated tag DIV']);
  });

  // "`<code>` is left alone". The site's homepage depends on every one of
  // these: it shows markout source inside <code> without escaping a single
  // `${...}`, and a change here would silently interpolate the samples
  // rather than fail anything.
  it('leaves the content of <code> unparsed', async () => {
    const result = await render(
      '<html :count=${0}><body>' +
        '<pre><code>&lt;div :count=${0}&gt;${count}&lt;/div&gt;</code></pre>' +
        '</body></html>'
    );

    expectClean(result);
    // as typed: the interpolations are characters, not bindings
    expect(result.body).toContain('&lt;div :count=${0}&gt;${count}&lt;/div&gt;');
  });

  it('still binds the attributes of the <code> tag itself', async () => {
    const result = await render(
      '<html :lang=${"html"} :shown=${true}><body>' +
        '<code class="lang-${lang}" :if=${shown}>${lang}</code>' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('class="lang-html"');
    // the content stayed put even though the attribute did not
    expect(result.body).toContain('>${lang}</code>');
  });

  it('interpolates inside <pre>, which is not in that set', async () => {
    const result = await render('<html :x=${2}><body><pre>${x}</pre></body></html>');

    expectClean(result);
    expect(result.body).toContain('<pre>2</pre>');
  });

  it('ends <code> at the first close tag, so it cannot nest', () => {
    const source = parse(
      '<html><body><code>a <code>b</code> c</code></body></html>',
      'docs.html'
    );
    expect(source.errors.map(e => e.msg)).toStrictEqual([
      'Found </CODE> instead of </BODY>',
    ]);
  });
});

describe('docs/concepts/values.md — an expression is a starting point', () => {
  // The rule the section states: a value follows its expression until
  // something assigns it, and is what it was assigned from then on. Both
  // halves are asserted, because documenting only the first would describe a
  // language markout isn't, and only the second one it isn't either.
  function values(html: string) {
    const page = new Page(parse(html, 'values.html'));
    stage1load(page);
    stage2validate(page);
    stage3qualify(page);
    stage4resolve(page);
    stage7generate(page);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const ctx = new WebContext({
      ...loadProps(page.props!),
      doc: page.source.doc,
      server: true,
      onError: e => {
        throw new Error(e.message);
      },
    }).refresh();
    return {
      html: ctx.root.proxy as Record<string, any>,
      body: (ctx.root.children[1] as { proxy: Record<string, any> }).proxy,
    };
  }

  const PAGE = '<html :start=${5}><body :n=${start * 2}></body></html>';

  it('follows its expression while nothing has assigned it', () => {
    const v = values(PAGE);
    expect(v.body['n']).toBe(10);
    v.html['start'] = 100;
    expect(v.body['n']).toBe(200);
  });

  it('holds what it was assigned, and stops following', () => {
    const v = values(PAGE);
    expect(v.body['n']).toBe(10);
    v.body['n'] = 999;
    v.html['start'] = 100;
    expect(v.body['n']).toBe(999);
  });
});

describe('docs/concepts/values.md — how far a change travels', () => {
  // the behaviour these examples describe is pinned in
  // reactivity-pitfalls.test.ts, which drives the propagation; what is
  // checked here is that the markup a reader would copy compiles and says
  // what the prose says it says
  it('renders the projection example', async () => {
    const result = await render(
      '<html><body><div :src=${({ a: 1, b: 2 })} :b=${src.b}>' +
        '<p>${b}</p></div></body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('<p>2</p>');
  });

  it('renders the whole-value write example', async () => {
    const result = await render(
      '<html><body><div :src=${({ a: 1, b: 2 })}>' +
        '<button :on-click=${() => src = { ...src, b: 3 }}>bump</button>' +
        '<p>${src.b}</p></div></body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('<p>2</p>');
  });
});

describe('docs/concepts/scope.md', () => {
  it('renders the $id anchoring example', async () => {
    const result = await render(
      '<html><head><:define tag="bs-nav:nav" :_id=${$id}>' +
        '<button data-bs-target="#nav-${_id}" aria-controls="nav-${_id}">t</button>' +
        '<div class="collapse" id="nav-${_id}">c</div>' +
        '</:define></head><body><bs-nav /><bs-nav /></body></html>'
    );

    expectClean(result);
    const ids = [...result.body.matchAll(/id="(nav-[^"]*)"/g)].map(m => m[1]);
    // one id per instance, and the three references within an instance agree
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(result.body).toContain(`data-bs-target="#${id}"`);
      expect(result.body).toContain(`aria-controls="${id}"`);
    }
  });
});

describe('docs/concepts/page.md', () => {
  it('renders the default-scopes example, and writes the title from the body', async () => {
    const result = await render(
      "<html><head :pageTitle=${'Home'}><title>${pageTitle} — Example</title></head>" +
        '<body><h1>${head.pageTitle}</h1>' +
        "<button :on-click=${() => head.pageTitle = 'About'}>About</button>" +
        '</body></html>'
    );

    expectClean(result);
    expect(result.head).toContain('<title>Home — Example</title>');
    // the same value, read from the other side of the page
    expect(result.body).toContain('<h1>Home</h1>');
  });

  it('lets a definition set it, since `head` is not the caller\'s name', async () => {
    // the isolation rule a definition lives under is about names its CALLER
    // declared; `head` is on the page scope, which is an ancestor of the
    // definition's own markup as much as of anything else
    const result = await render(
      "<html><head :pageTitle=${'Home'}><title>${pageTitle}</title>" +
        '<:define tag="my-page:div" ::t="x" :_titled=${(head.pageTitle = t, true)}>' +
        '${t}</:define></head>' +
        "<body><my-page ::t=${'About'} /></body></html>"
    );

    expectClean(result);
    expect(result.head).toContain('<title>About</title>');
  });
});

describe('docs/concepts/navigation.md', () => {
  // the fragment-routed page, exactly as the doc prints it. `render()` has
  // no address to give it, which is the case that matters here and the
  // reason the example says `?.`: `$url` is undefined in a build with no
  // origin, and without the guard this renders nothing and reports
  // "Cannot read properties of undefined (reading 'hash')"
  const PAGE =
    "<html :route=${$url?.hash.slice(1) || 'home'}>" +
    '<head><title>${route} — site</title></head>' +
    '<body>' +
    '<nav>' +
    '<a href="#home" :class-active=${route === \'home\'}>Home</a>' +
    '<a href="#about" :class-active=${route === \'about\'}>About</a>' +
    '</nav>' +
    "<:group :if=${route === 'home'}><h1>Home</h1><p>Welcome.</p></:group>" +
    "<:group :if=${route === 'about'}><h1>About</h1><p>Us.</p></:group>" +
    '</body></html>';

  it('renders the fragment-routed page', async () => {
    const result = await render(PAGE);

    expectClean(result);
    // the default route, which is what a response always carries: no
    // fragment ever reaches a server
    expect(result.body).toContain('<h1>Home</h1>');
    expect(result.body).not.toContain('<h1>About</h1>');
    // the value declared on the root tag reaches the nav in <body>...
    expect(result.body).toMatch(/<a class="active" href="#home"/);
    expect(result.body).not.toMatch(/class="active" href="#about"/);
  });

  it('reads the same route value from the head', async () => {
    const result = await render(PAGE);
    // ...and <head>, which is the reason the doc puts it on <html>
    expect(result.head).toContain('<title>home — site</title>');
  });
});

describe('docs/concepts/kits.md', () => {
  const CARD =
    '<:define tag="my-card:div" class="card" ::title="Untitled">' +
    '<h5>${title}</h5></:define>';

  it('renders the parameters-and-defaults example', async () => {
    const result = await render(
      `<html :post=\${{ name: "From data" }}><head>${CARD}</head><body>` +
        '<my-card /><my-card ::title="Hello" /><my-card ::title=${post.name} />' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('Untitled');
    expect(result.body).toContain('Hello');
    expect(result.body).toContain('From data');
  });

  it('renders the slot example, with and without content', async () => {
    const result = await render(
      '<html><head><:define tag="my-card:div" class="card">' +
        '<div class="body"><:slot>Nothing here yet.</:slot></div>' +
        '</:define></head><body>' +
        '<my-card><p>Anything you like.</p></my-card><my-card />' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('<div class="body"><p>Anything you like.</p></div>');
    expect(result.body).toContain('<div class="body">Nothing here yet.</div>');
  });

  it('renders the named-slot example', async () => {
    const result = await render(
      '<html><head><:define tag="my-panel:section" ::title="T">' +
        '<header><:slot name="header">${title}</:slot></header>' +
        '<div class="body"><:slot /></div>' +
        '</:define></head><body>' +
        '<my-panel><h2 :slot="header">Custom heading</h2>' +
        'Everything else fills the unnamed slot.</my-panel>' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('<header><h2>Custom heading</h2></header>');
    expect(result.body).toContain('Everything else fills the unnamed slot.');
  });

  it('renders the composing example', async () => {
    const result = await render(
      '<html :posts=${[{ title: "One", tag: "a" }, { title: "Two", tag: "b" }]}>' +
        '<head><:define tag="my-badge:span" class="badge" ::label="">${label}</:define>' +
        '<:define tag="my-card:div" class="card" ::title="Untitled">' +
        '<h5>${title}</h5><div class="body"><:slot /></div></:define>' +
        '</head><body><ul><li :for-each=${posts}>' +
        '<my-card ::title=${data.title}><my-badge ::label=${data.tag} /></my-card>' +
        '</li></ul></body></html>'
    );

    expectClean(result);
    // one card per post, each with its own badge, all reading the loop's item
    const live = result.body;
    expect(live).toContain('One');
    expect(live).toContain('Two');
    expect(live).toContain('<span class="badge">a</span>');
    expect(live).toContain('<span class="badge">b</span>');
  });

  it('renders the resolves-where-written example', async () => {
    const result = await render(
      '<html :label=${"page"}><head>' +
        '<:define tag="my-box:div" ::label=${"definition"}><:slot /></:define>' +
        '</head><body><my-box>${label}</my-box></body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('page');
    expect(result.body).not.toContain('definition');
  });

  // "A parameter goes in, and does not come back": the doc states two numbers
  // after the click -- the instance at 2, the page's own value still at 1 --
  // and the whole point of the section is that nothing reports the second.
  // A rendering check would see neither.
  it('does not write a parameter back to the caller', () => {
    const page = new Page(
      parse(
        '<html :amount=${1}><body>' +
          '<:define tag="my-dial:div" ::value=${0}' +
          ' :bump=${() => value += 1}>${value}</:define>' +
          '<my-dial :aka="dial" ::value=${amount} />' +
          '<p>${dial.value}|${amount}</p>' +
          '</body></html>',
        'kits.html'
      )
    );
    stage1load(page);
    stage2validate(page);
    stage3qualify(page);
    stage4resolve(page);
    stage7generate(page);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);

    const errors: string[] = [];
    const ctx = new WebContext({
      ...loadProps(page.props!),
      doc: page.source.doc,
      onError: e => errors.push(e.message),
    }).refresh();
    const shown = () => {
      const m = page.source.doc.toString().replace(/<!--.*?-->/g, '');
      return /<p>([^<]*)<\/p>/.exec(m.slice(m.indexOf('<body')))?.[1];
    };

    expect(shown()).toBe('1|1');
    const body = ctx.root.children[1] as { proxy: Record<string, any> };
    body.proxy['dial'].bump();
    expect(shown()).toBe('2|1');
    // and the silence is the finding, so it is asserted rather than assumed
    expect(errors).toStrictEqual([]);
  });

  // The "a definition reads as a class body" example: the point of it is that
  // a definition holds grouped, commented, multiline declarations AND that
  // `:bump` is a method a usage site can call by name. Rendering it would
  // check the first half only, so this one drives the second.
  it('calls a definition\'s method through the name a usage site gave it', () => {
    const page = new Page(
      parse(
        '<html><body>' +
          '<:define tag="my-counter:div"\n' +
          '  // parameters\n\n' +
          '  ::start=${0}\n' +
          '  ::step=${1}\n' +
          '  // private\n\n' +
          '  :_count=${start}\n' +
          '  // read from outside\n\n' +
          '  :value=${_count}\n' +
          // the block body and the comment inside it are the point: this is
          // the form the docs show, so it is the form that gets compiled
          '  :bump=${() => {\n' +
          '    /*\n' +
          '     since properties are reactive,\n' +
          '     this assignment transparently updates all\n' +
          '     dependents of `_count`\n' +
          '    */\n' +
          '    _count += step;\n' +
          '  }}\n' +
          '>${_count}</:define>' +
          '<my-counter :aka="c" ::start=${5} ::step=${2} />' +
          '<p>${c.value}</p>' +
          '</body></html>',
        'kits.html'
      )
    );
    stage1load(page);
    stage2validate(page);
    stage3qualify(page);
    stage4resolve(page);
    stage7generate(page);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);

    const errors: string[] = [];
    const ctx = new WebContext({
      ...loadProps(page.props!),
      doc: page.source.doc,
      onError: e => errors.push(e.message),
    }).refresh();
    const shown = () => {
      const m = page.source.doc.toString().replace(/<!--.*?-->/g, '');
      return /<p>([^<]*)<\/p>/.exec(m.slice(m.indexOf('<body')))?.[1];
    };

    expect(shown()).toBe('5');
    const body = ctx.root.children[1] as { proxy: Record<string, any> };
    body.proxy['c'].bump();
    expect(shown()).toBe('7');
    body.proxy['c'].bump();
    expect(shown()).toBe('9');
    expect(errors).toStrictEqual([]);
  });
});

describe('docs/concepts/data.md', () => {
  it('renders the durable-app-state example', async () => {
    // the point of the snippet is that typing folds the note back into
    // `tracks` rather than leaving it in the element, so the assertion is on
    // the written-back attribute: that is the half a datasource could save
    const result = await render(
      "<html><body :tracks=${[{ id: 'lantern', name: 'Lantern Season', note: 'capo 3' }]}>" +
        '<ol><li :for-each=${tracks} :for-key=${data.id}>' +
        '<input value=${data.note} :prop-value=${data.note}' +
        ' :on-input=${e => tracks = tracks.map(t =>' +
        ' t.id === data.id ? { ...t, note: e.target.value } : t)}>' +
        '</li></ol></body></html>'
    );

    expectClean(result);
    const live = result.body;
    expect(live).toContain('value="capo 3"');
  });

  it('renders the ephemeral-view-state example', async () => {
    const result = await render(
      "<html><body :activeSeason=${'All'}>" +
        "<button :for-each=${['All', 'Spring']} :on-click=${() => activeSeason = data}>" +
        '${data}</button><p>${activeSeason}</p></body></html>'
    );

    expectClean(result);
    // server-rendered from the values alone, which is the reason it has to be
    // data at all rather than something the DOM remembers
    expect(result.body).toContain('<p>All</p>');
    const live = result.body;
    expect(live).toContain('>All<');
    expect(live).toContain('>Spring<');
  });
});

describe('docs/concepts/directives.md', () => {
  it('renders the :for-key example', async () => {
    const result = await render(
      '<html :rows=${[{ id: "a", label: "One" }, { id: "b", label: "Two" }]}>' +
        '<body><ul><li :for-each=${rows} :for-key=${data.id}>' +
        '<input> ${data.label}' +
        '</li></ul></body></html>'
    );

    expectClean(result);
    // one replica per row, each reading its own item -- a key changes which
    // replica an item belongs to, never what gets rendered
    const live = result.body;
    expect(live).toContain('One');
    expect(live).toContain('Two');
  });
});
