import { NodeType } from '../../src/html/dom';
import { Source, parse } from '../../src/html/parser';
import {
    ServerDocument,
    ServerElement,
    ServerTemplateElement,
    SourceLocation
} from '../../src/html/server-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { stage1load } from '../../src/compiler/stages/stage1-load';

const LOC: SourceLocation = {
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
  i1: 0,
  i2: 0,
};

describe('stage1-loader', () => {
  let doc: ServerDocument;

  beforeEach(() => {
    doc = new ServerDocument('test');
  });

  // Helper to get the loaded scope (child of global)
  function getLoadedScope(context: Page) {
    return context.global.children[0];
  }

  function getChildScope(scope: Page['global'], index = 0) {
    return scope.children[index];
  }

  function runLoader(root: ServerElement): Page {
    const source = new Source('', 'test');
    source.doc.appendChild(root);
    return stage1load(new Page(source))!;
  }

  function runLoaderFromMarkup(markup: string): Page {
    return stage1load(new Page(parse(markup, 'test')))!;
  }

  describe('loader function', () => {
    it('should create a context from a ServerElement', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      expect(context).toBeInstanceOf(Page);
      expect(context.global).toBeDefined();
      expect(context.errors).toStrictEqual([]);
    });

    it('should set default scope name to "page"', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('page');
    });

    it('should store the element in the loaded scope', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.e).toBe(root);
    });

    it('should create a global scope with no parent', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      expect(context.global.parent).toBeUndefined();
    });

    it('should create the loaded scope as a child of global', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.parent).toBe(context.global);
    });
  });

  describe(':aka attribute handling', () => {
    it('should ignore other special attributes', () => {
      const root = new ServerElement(doc, 'html', LOC);
      root.setAttribute(':other', 'value');
      root.setAttribute(':foo', 'bar');
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('page');
      expect(context.errors).toStrictEqual([]);
    });

    it('should ignore regular attributes without colon prefix', () => {
      const root = new ServerElement(doc, 'html', LOC);
      root.setAttribute('class', 'container');
      root.setAttribute('id', 'main');
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('page');
      expect(context.errors).toStrictEqual([]);
    });
  });

  describe('reserved scope names', () => {
    it('should keep html scope name reserved', () => {
      const root = new ServerElement(doc, 'html', LOC);
      root.setAttribute(':aka', 'customPage');
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('page');
      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].msg).toBe('Cannot redefine scope name: "page"');
    });

    it('should keep head scope name reserved', () => {
      const root = new ServerElement(doc, 'head', LOC);
      root.setAttribute(':aka', 'customHead');
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('head');
      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].msg).toBe('Cannot redefine scope name: "head"');
    });

    it('should keep body scope name reserved', () => {
      const root = new ServerElement(doc, 'body', LOC);
      root.setAttribute(':aka', 'customBody');
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('body');
      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].msg).toBe('Cannot redefine scope name: "body"');
    });
  });

  describe('scope creation', () => {
    it('should initialize loaded scope with empty children array', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.children).toStrictEqual([]);
    });

    it('should initialize loaded scope with empty values map', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.values.size).toBe(0);
    });

    it('should create context with empty errors array on success', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      expect(context.errors).toStrictEqual([]);
    });

    it('should create scopes recursively for html, head, and body', () => {
      const context = runLoaderFromMarkup(
        '<html><head></head><body><section></section></body></html>'
      );

      const htmlScope = getLoadedScope(context);
      const headScope = getChildScope(htmlScope, 0);
      const bodyScope = getChildScope(htmlScope, 1);

      expect(htmlScope.name).toBe('page');
      expect(htmlScope.children).toHaveLength(2);
      expect(headScope.e?.tagName).toBe('HEAD');
      expect(headScope.name).toBe('head');
      expect(bodyScope.e?.tagName).toBe('BODY');
      expect(bodyScope.name).toBe('body');
      expect(bodyScope.children).toHaveLength(0);
    });

    it('should create scopes for descendants with special attributes', () => {
      const context = runLoaderFromMarkup(
        '<html><body><section><div :x="a"><span></span></div></section></body></html>'
      );

      const htmlScope = getLoadedScope(context);
      const bodyScope = getChildScope(htmlScope, 1);
      const divScope = getChildScope(bodyScope, 0);

      expect(bodyScope.e?.tagName).toBe('BODY');
      expect(divScope.e?.tagName).toBe('DIV');
      expect(divScope.parent).toBe(bodyScope);
      expect(divScope.e?.parentElement?.tagName).toBe('SECTION');
      expect(divScope.values.size).toBe(1);
      expect(divScope.values.has('x')).toBe(true);
      expect(divScope.children).toHaveLength(0);
    });

  });

  describe('logic value loading', () => {
    it('should load directive values for logic attributes', () => {
      const context = runLoaderFromMarkup(
        "<html :x=\"a\" :y=\"some ${'text'}\" :z=${0}></html>"
      );
      const loadedScope = getLoadedScope(context);

      expect(loadedScope.values.size).toBe(3);
      expect(loadedScope.values.has('x')).toBe(true);
      expect(loadedScope.values.has('y')).toBe(true);
      expect(loadedScope.values.has('z')).toBe(true);

      const x = loadedScope.values.get('x');
      const y = loadedScope.values.get('y');
      const z = loadedScope.values.get('z');

      expect(x?.name).toBe('x');
      expect(x?.value).toBe('a');

      expect(y?.name).toBe('y');
      expect(y?.value).toMatchObject({ type: 'TemplateLiteral' });

      expect(z?.name).toBe('z');
      expect(z?.value).toMatchObject({ type: 'Literal', value: 0 });
    });

    it('should load a plain attribute with a ${} value as an attr$ value', () => {
      const context = runLoaderFromMarkup(
        '<html :n=${1}><body><a href=${`#${n}`} data-count=${n} rel="static">x</a></body></html>'
      );
      // children[0] is the implicit <head>
      const body = getChildScope(getLoadedScope(context), 1);
      const anchor = getChildScope(body, 0);

      expect(anchor.values.has('attr$href')).toBe(true);
      expect(anchor.values.has('attr$data-count')).toBe(true);
      // a plain (non-interpolated) value stays a literal attribute
      expect(anchor.values.has('attr$rel')).toBe(false);
      expect(anchor.values.get('attr$data-count')?.value).toMatchObject({
        type: 'Identifier',
        name: 'n',
      });
    });

    it('should give an element its own scope for a ${} attribute alone', () => {
      // without one, the attr$ value would land on the enclosing scope and
      // set the attribute on that scope's element instead of this one
      const context = runLoaderFromMarkup(
        '<html :n=${1}><body><span data-n=${n}>x</span><span>y</span></body></html>'
      );
      const body = getChildScope(getLoadedScope(context), 1);

      expect(body.children.length).toBe(1);
      expect(body.values.has('attr$data-n')).toBe(false);
      expect(body.children[0].values.has('attr$data-n')).toBe(true);
    });

    it('should strip a ${} attribute from the served markup', () => {
      // it holds an expression, not a string: serialized as-is it would emit
      // an empty attribute, which the runtime then overwrites anyway
      const context = runLoaderFromMarkup(
        '<html :n=${1}><body><span data-n=${n} rel="static">x</span></body></html>'
      );
      const markup = context.source.doc.toString();

      expect(markup).not.toContain('data-n');
      expect(markup).toContain('rel="static"');
    });

    it('should not load :aka, :class-*, :style-*, or :on-* as logic values', () => {
      const context = runLoaderFromMarkup(
        '<html :aka="pageName" :class-active="yes" :style-color="red" :on-click="fn" :x="ok"></html>'
      );
      const loadedScope = getLoadedScope(context);

      expect(loadedScope.name).toBe('page');
      expect(loadedScope.values.size).toBe(4);
      expect(loadedScope.values.has('x')).toBe(true);
      expect(loadedScope.values.has('class$active')).toBe(true);
      expect(loadedScope.values.has('style$color')).toBe(true);
      expect(loadedScope.values.has('on$click')).toBe(true);
      expect(loadedScope.values.has('aka')).toBe(false);
    });

    it('should load :attr-* as a presence value, distinct from a valued one', () => {
      // `x=${...}` sets the attribute's value; `:attr-x` decides whether it
      // is there at all. Two intents, two spellings -- rather than inferring
      // which was meant from the shape of the value
      const context = runLoaderFromMarkup(
        '<html :n=${1}><body><b :attr-open=${true} :attr-aria-busy title=${n}>x</b></body></html>'
      );
      const body = getChildScope(getLoadedScope(context), 1);
      const b = getChildScope(body, 0);

      expect(context.errors).toStrictEqual([]);
      expect(b.values.has('flag$open')).toBe(true);
      expect(b.values.has('flag$aria-busy')).toBe(true);
      expect(b.values.has('attr$title')).toBe(true);
      // not a scope value called `open`, and not the valued form either
      expect(b.values.has('open')).toBe(false);
      expect(b.values.has('attr$open')).toBe(false);
    });

    it('should allow dashed class-/style-/on- suffixes and keep them dash-case verbatim', () => {
      const context = runLoaderFromMarkup(
        '<html :style-background-color="red" :class-is-active=${true} :on-item-selected=${() => {}}></html>'
      );
      const loadedScope = getLoadedScope(context);

      expect(loadedScope.values.has('style$background-color')).toBe(true);
      expect(loadedScope.values.has('class$is-active')).toBe(true);
      expect(loadedScope.values.has('on$item-selected')).toBe(true);
    });

    // reported rather than thrown: an exception would escape the compiler,
    // and the server can only build its error page from page.errors
    it('should reject a dash in a plain value name', () => {
      const page = runLoaderFromMarkup('<html :my-value="a"></html>');
      expect(page.errors.map(e => e.msg)).toStrictEqual(['Invalid name: "my-value"']);
    });

    it('should reject a dash in a :did-*/:will-* suffix', () => {
      const page = runLoaderFromMarkup('<html :did-my-thing=${() => {}}></html>');
      expect(page.errors.map(e => e.msg)).toStrictEqual(['Invalid name: "my-thing"']);
    });

    it('should reject a dollar sign even inside a dash-allowed class-/style-/on- suffix', () => {
      const page = runLoaderFromMarkup('<html :class-a$b=${true}></html>');
      expect(page.errors.map(e => e.msg)).toStrictEqual(['Invalid name: "a$b"']);
    });

    it('should reject a dash in an :aka scope name', () => {
      const page = runLoaderFromMarkup('<html><body><div :aka="my-name"></div></body></html>');
      expect(page.errors.map(e => e.msg)).toStrictEqual(['Invalid name: "my-name"']);
    });

    it('should reject a value name no expression could reference', () => {
      // the character check passes for every reserved word, so these used to
      // declare a value in good order that nothing could ever name. `:if` is
      // the one that matters: it is what someone arriving from another
      // framework writes first, and it silently rendered the element
      for (const name of ['if', 'class', 'for', 'return', 'true']) {
        const page = runLoaderFromMarkup(`<html :${name}=\${1}></html>`);
        expect(page.errors.map(e => e.msg)).toStrictEqual([
          `Invalid name: "${name}" is a reserved word or not a JS identifier, ` +
            'so no expression could reference it',
        ]);
      }
    });

    it('should reject a value name starting with a digit', () => {
      const page = runLoaderFromMarkup('<html :9lives=${1}></html>');
      expect(page.errors.length).toBe(1);
      expect(page.errors[0].msg).toContain('"9lives"');
    });

    it('should reject a reserved word as an :aka scope name too', () => {
      // a scope name is read back the same way a value is
      const page = runLoaderFromMarkup('<html><body><div :aka="class"></div></body></html>');
      expect(page.errors.length).toBe(1);
      expect(page.errors[0].msg).toContain('"class"');
    });

    it('should keep accepting names that merely look reserved', () => {
      // `let` and `undefined` ARE referenceable in the mode expressions are
      // parsed in, so the rule follows the parser rather than a word list
      const page = runLoaderFromMarkup(
        '<html :data=${1} :_w=${2} :item2=${3} :undefined=${4} :let=${5}></html>'
      );
      expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    });

    it('should leave the dash-case families alone', () => {
      // these name CSS properties, attributes and events -- never anything an
      // expression references, so the identifier rule must not reach them
      const page = runLoaderFromMarkup(
        '<html :class-my-thing=${1} :style-font-size=${2} :on-item-selected=${() => {}}' +
          ' :attr-aria-hidden=${true} :prop-someProp=${3}></html>'
      );
      expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    });

    it('should report every bad name, not just the first', () => {
      const page = runLoaderFromMarkup('<html :a-b="1"><body :c-d="2"></body></html>');
      expect(page.errors.map(e => e.msg)).toStrictEqual([
        'Invalid name: "a-b"',
        'Invalid name: "c-d"',
      ]);
    });

    it('should remove special attributes from the root element DOM', () => {
      const context = runLoaderFromMarkup(
        '<html :aka="pageName" :x="ok" lang="en"></html>'
      );
      const root = context.source.doc.documentElement!;

      expect(root.attributes.map(a => a.name)).toStrictEqual(['lang', 'data-markout']);
    });

    it('should remove special attributes from nested element DOM', () => {
      const context = runLoaderFromMarkup(
        '<html><body><div id="x" :x="v" :style-color="red"></div></body></html>'
      );
      const body = context.source.doc.body!;
      const div = body.childNodes[0] as ServerElement;

      expect(div.attributes.map(a => a.name)).toStrictEqual(['id', 'data-markout']);
    });
  });

  describe(':for-each/:for-as/:for-key loading', () => {
    it('should load :for-each as a for$each value', () => {
      const context = runLoaderFromMarkup(
        '<html><body><li :for-each=${items}></li></body></html>'
      );
      const htmlScope = getLoadedScope(context);
      const bodyScope = getChildScope(htmlScope, 1);
      const liScope = getChildScope(bodyScope, 0);

      expect(liScope.values.size).toBe(2);
      expect(liScope.values.has('for$each')).toBe(true);
      expect(liScope.values.get('for$each')?.value).toMatchObject({
        type: 'Identifier',
        name: 'items',
      });
      expect(liScope.values.has('data')).toBe(true);
    });

    it('should load :for-as and :for-key alongside :for-each', () => {
      const context = runLoaderFromMarkup(
        '<html><body><li :for-each=${items} :for-as="item" :for-key=${item.id}></li></body></html>'
      );
      const htmlScope = getLoadedScope(context);
      const bodyScope = getChildScope(htmlScope, 1);
      const liScope = getChildScope(bodyScope, 0);

      expect(liScope.values.size).toBe(4);
      expect(liScope.values.has('for$each')).toBe(true);
      expect(liScope.values.get('for$as')?.value).toBe('item');
      expect(liScope.values.get('for$key')?.value).toMatchObject({
        type: 'MemberExpression',
      });
      expect(liScope.values.has('item')).toBe(true);
      expect(liScope.values.has('data')).toBe(false);
    });

    it('should remove :for-each/:for-as/:for-key from the DOM element, keeping only data-markout', () => {
      const context = runLoaderFromMarkup(
        '<html><body><li :for-each=${items} :for-as="item" :for-key=${item.id}></li></body></html>'
      );
      const body = context.source.doc.body!;
      const template = body.childNodes[0] as ServerTemplateElement;
      const li = template.content.childNodes[0] as ServerElement;

      expect(template.tagName).toBe('TEMPLATE');
      expect(li.attributes.map(a => a.name)).toStrictEqual(['data-markout']);
    });

    it('should wrap the :for-each element in a <template>, leaving it as an inert stencil', () => {
      const context = runLoaderFromMarkup(
        '<html><body><li :for-each=${items}></li></body></html>'
      );
      const body = context.source.doc.body!;

      expect(body.childNodes.map((n: any) => n.tagName)).toStrictEqual(['TEMPLATE']);
    });
  });

  describe('text value loading', () => {
    it('should ignore static text and source formatting whitespace', () => {
      const context = runLoaderFromMarkup(
        `<html>
  <head>
    <title>Static title</title>
  </head>
  <body>
    <p>Static body</p>
  </body>
</html>`
      );
      const htmlScope = getLoadedScope(context);
      const headScope = getChildScope(htmlScope, 0);
      const bodyScope = getChildScope(htmlScope, 1);

      expect(htmlScope.textValues.size).toBe(0);
      expect(headScope.textValues.size).toBe(0);
      expect(bodyScope.textValues.size).toBe(0);
      expect(context.source.doc.toString().match(/-t\d+|\-\//g)).toBeNull();
    });

    it('should load expression text into scope text values', () => {
      const context = runLoaderFromMarkup('<html><body>${name}</body></html>');
      const htmlScope = getLoadedScope(context);
      const bodyScope = getChildScope(htmlScope, 1);

      expect(bodyScope.values.has('t$0')).toBe(false);
      expect(bodyScope.textValues.has('t$0')).toBe(true);
      const textValue = bodyScope.textValues.get('t$0');
      expect(textValue?.name).toBe('t$0');
      expect(textValue?.node.nodeType).toBe(NodeType.TEXT);
      expect((textValue?.node as any).textContent).toMatchObject({
        type: 'Identifier',
        name: 'name',
      });
    });

    it('should insert html markers around expression text nodes', () => {
      const context = runLoaderFromMarkup('<html><body>${name}</body></html>');
      const body = context.source.doc.body!;
      const children = body.childNodes;

      const markerComments = children
        .filter(node => node.nodeType === NodeType.COMMENT)
        .map(node => (node as any).textContent);

      expect(markerComments).toContain('-t0');
      expect(markerComments).toContain('-/');
      expect(
        children.some(node => {
          if (node.nodeType !== NodeType.TEXT) return false;
          const textContent = (node as any).textContent;
          return typeof textContent === 'object' && textContent?.type === 'Identifier';
        })
      ).toBe(true);
    });

    it('should add nested non-scope text values to the closest ancestor scope', () => {
      const context = runLoaderFromMarkup(
        '<html><body><section>${name}</section></body></html>'
      );
      const htmlScope = getLoadedScope(context);
      const bodyScope = getChildScope(htmlScope, 1);
      const section = context.source.doc.body!.childNodes[0] as ServerElement;

      expect(bodyScope.textValues.has('t$0')).toBe(true);
      const textValue = bodyScope.textValues.get('t$0');
      expect(textValue?.node.parentElement).toBe(section);

      const markerComments = section.childNodes
        .filter(node => node.nodeType === NodeType.COMMENT)
        .map(node => (node as any).textContent);
      expect(markerComments).toContain('-t0');
      expect(markerComments).toContain('-/');
    });
  });

  describe('edge cases', () => {
    it('should handle element with no attributes', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('page');
      expect(context.errors).toStrictEqual([]);
    });

    it('should preserve element reference in loaded scope', () => {
      const root = new ServerElement(doc, 'div', LOC);
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.e).toBe(root);
    });

    it('should work with various HTML elements', () => {
      const root = new ServerElement(doc, 'div', LOC);
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('page');
    });

    it('should work with custom elements', () => {
      const root = new ServerElement(doc, 'custom-element', LOC);
      const context = runLoader(root);

      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('page');
    });

    it('should add child scope to global.children', () => {
      const root = new ServerElement(doc, 'html', LOC);
      const context = runLoader(root);

      expect(context.global.children.length).toBe(1);
      expect(context.global.children[0]).toBe(getLoadedScope(context));
    });

    it('should preserve context errors across multiple operations', () => {
      const root = new ServerElement(doc, 'div', LOC);
      const context = runLoader(root);

      expect(context.errors).toStrictEqual([]);
      const loadedScope = getLoadedScope(context);
      expect(loadedScope.name).toBe('page');
    });
  });

  describe('<:define>/custom tags', () => {
    // a usage instance sits where the usage physically sits, so find it
    // anywhere in the tree rather than only among the root's own children
    function findUsage(page: Page, templateId?: string) {
      const hit = (s: any): any => {
        if (s.usesTemplate && (!templateId || s.usesTemplate === templateId)) return s;
        for (const c of s.children) {
          const found = hit(c);
          if (found) return found;
        }
        return undefined;
      };
      return hit(page.main!);
    }
    it('registers the definition and excludes it from its natural parent', () => {
      const page = runLoaderFromMarkup(
        `<html><head><:define tag="theme-switcher:button" :class-active>Switch</:define></head><body></body></html>`
      );
      expect(page.errors).toStrictEqual([]);
      expect([...page.customTags.keys()]).toStrictEqual(['theme-switcher']);
      const defScope = page.customTags.get('theme-switcher')!;
      expect(page.definitionScopes.has(defScope)).toBe(true);
      expect(defScope.e?.tagName).toBe('BUTTON');
      expect(defScope.values.has('class$active')).toBe(true);
    });

    it('registers a static definition without special attributes', () => {
      const page = runLoaderFromMarkup(
        `<html><head><:define tag="site-nav:nav" class="navbar">Navigation</:define></head>` +
        `<body><site-nav></site-nav></body></html>`
      );
      expect(page.errors).toStrictEqual([]);
      const defScope = page.customTags.get('site-nav')!;
      expect(defScope.e?.tagName).toBe('NAV');
      expect(defScope.e?.getAttribute('class')).toBe('navbar');
      expect(page.definitionScopes.has(defScope)).toBe(true);
      expect(findUsage(page, defScope.id)).toBeDefined();
    });

    it('places a usage instance where the usage physically sits', () => {
      // so :for-each replicates it and its DOM is found inside its
      // container; name resolution still starts at the page root, which
      // CoreScope.lexicalParent() handles off the back of usesTemplate
      const page = runLoaderFromMarkup(
        `<html><head><:define tag="theme-switcher:button" :class-active>Switch</:define></head>` +
        '<body><section :aka="sect"><theme-switcher></theme-switcher></section></body></html>'
      );
      expect(page.errors).toStrictEqual([]);
      const defScope = page.customTags.get('theme-switcher')!;
      const usage = findUsage(page, defScope.id);
      expect(usage).toBeDefined();
      expect(usage.parent!.name).toBe('sect');
      expect(usage.values.has('class$active')).toBe(true);
    });

    it('lets usage logic attributes override definition logic attributes', () => {
      const page = runLoaderFromMarkup(
        `<html><head><:define tag="theme-switcher:button" :class-active>Switch</:define></head>` +
        '<body><theme-switcher :class-active=${false}></theme-switcher></body></html>'
      );
      const usage = findUsage(page)!;
      expect(usage.values.get('class$active')!.value).toMatchObject({
        type: 'Literal',
        value: false,
      });
    });

    it('lets usage plain attributes override definition plain attributes', () => {
      const page = runLoaderFromMarkup(
        '<html><head><:define tag="site-nav:nav" class="navbar" id="default-nav">Navigation</:define></head>' +
        '<body><site-nav class="navbar-dark" id="main-nav"></site-nav></body></html>'
      );
      const usage = findUsage(page)!;
      expect(usage.attributes).toEqual(
        new Map([
          ['class', 'navbar-dark'],
          ['id', 'main-nav'],
        ])
      );
    });

    it('compiles dynamic usage plain attributes into attribute values', () => {
      const page = runLoaderFromMarkup(
        '<html :navId=${"main-nav"}><head><:define tag="site-nav:nav" id="default-nav">Navigation</:define></head>' +
        '<body><site-nav id=${navId}></site-nav></body></html>'
      );
      const usage = findUsage(page)!;
      expect(usage.attributes).toEqual(new Map());
      expect(usage.values.get('attr$id')!.value).toMatchObject({ type: 'Identifier', name: 'navId' });
    });

    it('replaces the usage element with a comment marker in the DOM', () => {
      const page = runLoaderFromMarkup(
        `<html><head><:define tag="theme-switcher:button" :class-active>Switch</:define></head>` +
        `<body><theme-switcher></theme-switcher></body></html>`
      );
      const body = (page.source.doc as any).documentElement.childNodes.find(
        (n: any) => n.tagName === 'BODY'
      );
      const tags = body.childNodes.map((n: any) => n.tagName ?? n.nodeType);
      expect(tags).not.toContain('THEME-SWITCHER');
      const usage = findUsage(page);
      const marker = body.childNodes.find(
        (n: any) => n.nodeType === NodeType.COMMENT && n.textContent === `-u${usage!.id}`
      );
      expect(marker).toBeDefined();
    });

    it('reports an error for a malformed tag attribute', () => {
      const page = runLoaderFromMarkup(
        `<html><head><:define tag="not-valid">x</:define></head><body></body></html>`
      );
      expect(page.errors.length).toBe(1);
      expect(page.errors[0].msg).toContain('tag');
    });

    it('does nothing when there are no usage sites', () => {
      const page = runLoaderFromMarkup(
        `<html><head><:define tag="theme-switcher:button">Switch</:define></head><body></body></html>`
      );
      expect(page.errors).toStrictEqual([]);
      expect(findUsage(page)).toBeUndefined();
    });

    // these used to be skipped in silence: the usage sits inside a
    // <template>, which a childNodes walk never sees into, so the custom tag
    // survived into the served markup and rendered nothing at all
    it('expands a usage inside :for-each, under the replicated scope', () => {
      const page = runLoaderFromMarkup(
        `<html><head><:define tag="theme-switcher:button">Switch</:define></head>` +
        '<body><div :for-each=${[1, 2]}><theme-switcher /></div></body></html>'
      );
      expect(page.errors).toStrictEqual([]);
      const usage = findUsage(page);
      expect(usage).toBeDefined();
      // parented at the :for-each host, so every replica gets an instance
      expect(usage.parent!.values.has('for$each')).toBe(true);
    });

    it('expands a usage inside another <:define>', () => {
      const page = runLoaderFromMarkup(
        `<html><head>` +
        `<:define tag="theme-switcher:button">Switch</:define>` +
        `<:define tag="site-nav:nav"><theme-switcher /></:define>` +
        `</head><body><site-nav /></body></html>`
      );
      expect(page.errors).toStrictEqual([]);
      const inner = page.customTags.get('theme-switcher')!;
      const outer = page.customTags.get('site-nav')!;
      // the inner instance hangs off the outer definition, so it comes along
      // with every instance of the outer tag
      expect(outer.children.some(c => c.usesTemplate === inner.id)).toBe(true);
    });

    it('expands a usage that merely follows a <template> sibling', () => {
      const page = runLoaderFromMarkup(
        `<html><head><:define tag="theme-switcher:button">Switch</:define></head>` +
        '<body><div :for-each=${[1, 2]}>x</div><theme-switcher /></body></html>'
      );
      expect(page.errors).toStrictEqual([]);
      expect(findUsage(page)).toBeDefined();
    });
  });
});
