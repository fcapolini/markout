import { assert, describe, it } from 'vitest';
import {
  ServerComment,
  ServerContainerNode,
  ServerDocument,
  ServerElement,
  ServerNode,
  ServerTemplateElement,
  ServerText,
  SourceLocation,
} from '../../src/html/server-dom';
import {
  Element,
  Node,
  NodeType,
  TemplateElement,
  Text,
} from '../../src/html/dom';

const LOC: SourceLocation = {
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
  i1: 0,
  i2: 0,
};

describe('node', () => {
  it('should append a node', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    assert.equal(doc.toString(), `<html></html>`);
  });

  it('should append a node', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    const text = root.appendChild(new ServerText(doc, 'test', LOC)) as Text;
    assert.equal(doc.toString(), `<html>test</html>`);
    text.unlink();
    assert.equal(doc.toString(), `<html></html>`);
  });

  it('should implement dummy addEventListener()', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    root.addEventListener('dummy', () => {});
  });

  it('should remove a child node', () => {
    const doc = new ServerDocument('test');
    assert.equal(doc.childNodes.length, 0);
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    assert.equal(doc.childNodes.length, 1);
    doc.removeChild(root);
    assert.equal(doc.childNodes.length, 0);
  });

  it('should implement dummy removeEventListener()', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    root.removeEventListener('dummy', () => {});
  });

  it('should clone a node', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as ServerElement;
    const t = root.appendChild(new ServerText(doc, 'test', LOC)) as ServerText;
    const e = root.appendChild(
      new ServerElement(doc, 'div', LOC)
    ) as ServerElement;
    e.setAttribute('class', 'a');
    e.appendChild(new ServerText(doc, 'text', LOC));
    e.appendChild(new ServerElement(doc, 'p', LOC));
    const c = root.appendChild(
      new ServerComment(doc, 'test', LOC)
    ) as ServerComment;
    assert.equal(
      doc.toString(),
      `<html>test<div class="a">text<p></p></div><!--test--></html>`
    );
    t.clone(doc, root);
    e.clone(doc, root);
    c.clone(doc, root);
    assert.equal(
      doc.toString(),
      `<html>test<div class="a">text<p></p></div><!--test-->` +
        `test<div class="a">text<p></p></div><!--test--></html>`
    );
  });
});

describe('document', () => {
  it('should implement documentElement property', () => {
    const doc = new ServerDocument('test');
    assert.isNull(doc.documentElement);
    const root = doc.appendChild(new ServerElement(doc, 'html', LOC));
    assert.equal(doc.documentElement, root);
  });

  it('should implement head property', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    assert.isNull(doc.head);
    assert.equal(doc.toString(), `<html></html>`);
    const head = root.appendChild(new ServerElement(doc, 'head', LOC));
    assert.equal(doc.head, head);
    assert.equal(doc.toString(), `<html><head></head></html>`);
  });

  it('should implement body property', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    assert.isNull(doc.body);
    assert.equal(doc.toString(), `<html></html>`);
    const body = root.appendChild(new ServerElement(doc, 'body', LOC));
    assert.equal(doc.body, body);
    assert.equal(doc.toString(), `<html><body></body></html>`);
  });
});

describe('classList', () => {
  it('should set w/ className and read w/ classList', () => {
    const doc = new ServerDocument('test');
    const root = new ServerElement(doc, 'html', LOC);
    assert.equal(root.classList.length, 0);
    root.className = 'class1';
    assert.equal(root.classList.length, 1);
    assert.equal(root.classList.toString(), 'class1');
    root.className = 'a b';
    assert.equal(root.classList.length, 2);
    assert.equal(root.classList.toString(), 'a b');
    assert.equal(root.toString(), `<html class="a b"></html>`);
  });

  it('should set w/ classList and read w/ className', () => {
    const doc = new ServerDocument('test');
    const root = new ServerElement(doc, 'html', LOC);
    assert.equal(root.className, '');
    root.classList.add('a');
    assert.equal(root.classList.length, 1);
    assert.equal(root.className, 'a');
    root.classList.add('b');
    assert.equal(root.classList.length, 2);
    assert.equal(root.className, 'a b');
    root.classList.remove('a');
    assert.equal(root.classList.length, 1);
    assert.equal(root.className, 'b');
    root.classList.remove('a');
    assert.equal(root.classList.length, 1);
    assert.equal(root.className, 'b');
    root.classList.remove('b');
    assert.equal(root.classList.length, 0);
    assert.equal(root.className, '');
    assert.equal(root.toString(), `<html class=""></html>`);
  });

  it('should set w/ className and read w/ getAttribute', () => {
    const doc = new ServerDocument('test');
    const root = new ServerElement(doc, 'html', LOC);
    assert.notExists(root.getAttribute('class'));
    assert.isFalse(root.getAttributeNames().includes('class'));
    root.className = 'class1';
    assert.exists(root.getAttribute('class'));
    assert.isTrue(root.getAttributeNames().includes('class'));
    assert.equal(root.getAttribute('class'), 'class1');
  });

  it('should set w/ classList and read w/ getAttribute', () => {
    const doc = new ServerDocument('test');
    const root = new ServerElement(doc, 'html', LOC);
    assert.notExists(root.getAttribute('class'));
    assert.isFalse(root.getAttributeNames().includes('class'));
    root.classList.add('class1');
    assert.exists(root.getAttribute('class'));
    assert.isTrue(root.getAttributeNames().includes('class'));
    assert.equal(root.getAttribute('class'), 'class1');
  });

  it('should integrate className, classList and `class` attribute (1)', () => {
    const doc = new ServerDocument('test');
    const e = new ServerElement(doc, 'html', LOC);
    assert.equal(e.toString(), '<html></html>');
    assert.notExists(e.getAttribute('class'));
    assert.isFalse(e.getAttributeNames().includes('class'));
    assert.equal(e.className, '');
    assert.equal(e.classList.length, 0);
    e.className = 'a';
    assert.equal(e.toString(), '<html class="a"></html>');
    assert.exists(e.getAttribute('class'));
    assert.isTrue(e.getAttributeNames().includes('class'));
    assert.equal(e.className, 'a');
    assert.equal(e.classList.length, 1);
  });

  it('should integrate className, classList and `class` attribute (1)', () => {
    const doc = new ServerDocument('test');
    const e = new ServerElement(doc, 'html', LOC);
    assert.equal(e.toString(), '<html></html>');
    assert.notExists(e.getAttribute('class'));
    assert.isFalse(e.getAttributeNames().includes('class'));
    assert.equal(e.className, '');
    assert.equal(e.classList.length, 0);
    e.setAttribute('class', 'a');
    assert.equal(e.toString(), '<html class="a"></html>');
    assert.exists(e.getAttribute('class'));
    assert.isTrue(e.getAttributeNames().includes('class'));
    assert.equal(e.className, 'a');
    assert.equal(e.classList.length, 1);
  });
});

describe('style', () => {
  it('should set as string', () => {
    const doc = new ServerDocument('test');
    const root = new ServerElement(doc, 'html', LOC);
    assert.deepEqual(root.style.cssText, '');
    root.style = 'color: red';
    assert.equal(root.style.getPropertyValue('color'), 'red');
    root.style = 'margin: 0px; border: 0px';
    assert.equal(root.style.getPropertyValue('color'), '');
    assert.equal(root.style.getPropertyValue('margin'), '0px');
    assert.equal(root.style.getPropertyValue('border'), '0px');
    assert.equal(
      root.toString(),
      `<html style="margin: 0px; border: 0px;"></html>`
    );
  });

  it('should set/get w/ setProperty()/getPropertyValue()', () => {
    const doc = new ServerDocument('test');
    const root = new ServerElement(doc, 'html', LOC);
    root.style.setProperty('color', 'blue');
    assert.equal(root.style.cssText, 'color: blue;');
    root.style.setProperty('border', '0px');
    assert.equal(root.style.cssText, 'color: blue; border: 0px;');
    assert.equal(
      root.toString(),
      `<html style="color: blue; border: 0px;"></html>`
    );
  });

  it('should integrate `style` property and `style` attribute (1)', () => {
    const doc = new ServerDocument('test');
    const e = new ServerElement(doc, 'html', LOC);
    assert.equal(e.toString(), '<html></html>');
    assert.notExists(e.getAttribute('style'));
    assert.isFalse(e.getAttributeNames().includes('style'));
    assert.equal(e.style.cssText, '');
    // e.style.cssText = 'color: red';
    e.style.setProperty('color', 'red');
    assert.equal(e.toString(), '<html style="color: red;"></html>');
    assert.exists(e.getAttribute('style'));
    assert.isTrue(e.getAttributeNames().includes('style'));
    assert.equal(e.style.cssText, 'color: red;');
  });
});

describe('template', () => {
  it('should support cloning template tag (1)', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    const tpl = root.appendChild(
      new ServerTemplateElement(doc, LOC)
    ) as TemplateElement;
    tpl.setAttribute('id', 'tpl');
    const p1 = tpl.appendChild(new ServerElement(doc, 'p', LOC)) as Element;
    p1.setAttribute('a', '1');
    p1.appendChild(new ServerText(doc, 'text', LOC));
    const slot = p1.appendChild(new ServerElement(doc, 'slot', LOC)) as Element;
    slot.setAttribute('name', 'slot1');

    assert.equal(
      root.toString(),
      `<html>` +
        `<template id="tpl"><p a="1">text<slot name="slot1"></slot></p></template>` +
        `</html>`
    );

    const tpl2 = tpl.cloneNode(true);
    assert.isTrue(compareNode(tpl, tpl2));
    assert.equal(
      tpl2.toString(),
      `<template id="tpl"><p a="1">text<slot name="slot1"></slot></p></template>`
    );
  });

  it('should support cloning template tag (2)', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    const tpl = root.appendChild(
      new ServerTemplateElement(doc, LOC)
    ) as TemplateElement;
    tpl.setAttribute('id', 'tpl');
    const p1 = tpl.appendChild(new ServerElement(doc, 'p', LOC)) as Element;
    p1.setAttribute('class', 'a');
    p1.setAttribute('style', 'color: red');
    p1.appendChild(new ServerText(doc, 'text', LOC));
    const slot = p1.appendChild(new ServerElement(doc, 'slot', LOC)) as Element;
    slot.setAttribute('name', 'slot1');

    assert.equal(
      root.toString(),
      `<html>` +
        `<template id="tpl"><p class="a" style="color: red;">text<slot name="slot1"></slot></p></template>` +
        `</html>`
    );

    const tpl2 = tpl.cloneNode(true);
    assert.isTrue(compareNode(tpl, tpl2));
    assert.equal(
      tpl2.toString(),
      `<template id="tpl"><p class="a" style="color: red;">text<slot name="slot1"></slot></p></template>`
    );
  });

  it('should support cloning template content (1)', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    const tpl = root.appendChild(
      new ServerTemplateElement(doc, LOC)
    ) as TemplateElement;
    tpl.setAttribute('id', 'tpl');
    const p1 = tpl.appendChild(new ServerElement(doc, 'p', LOC)) as Element;
    p1.setAttribute('a', '1');
    p1.appendChild(new ServerText(doc, 'text', LOC));
    const slot = p1.appendChild(new ServerElement(doc, 'slot', LOC)) as Element;
    slot.setAttribute('name', 'slot1');

    const cnt2 = tpl.content.cloneNode(true);
    assert.isTrue(compareNode(tpl.content, cnt2));
    assert.equal(
      cnt2.toString(),
      `<p a="1">text<slot name="slot1"></slot></p>`
    );

    root.appendChild(cnt2);
    assert.equal(
      root.toString(),
      `<html>` +
        `<template id="tpl"><p a="1">text<slot name="slot1"></slot></p></template>` +
        `<p a="1">text<slot name="slot1"></slot></p>` +
        `</html>`
    );
  });

  it('should support cloning template content (2)', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;
    const tpl = root.appendChild(
      new ServerTemplateElement(doc, LOC)
    ) as TemplateElement;
    tpl.setAttribute('id', 'tpl');
    const p1 = tpl.appendChild(new ServerElement(doc, 'p', LOC)) as Element;
    // p1.setAttribute('class', 'a');
    p1.classList.add('a');
    // p1.setAttribute('style', 'color: red');
    p1.style.setProperty('color', 'red');
    p1.appendChild(new ServerText(doc, 'text', LOC));
    const slot = p1.appendChild(new ServerElement(doc, 'slot', LOC)) as Element;
    slot.setAttribute('name', 'slot1');

    const cnt2 = tpl.content.cloneNode(true);
    assert.isTrue(compareNode(tpl.content, cnt2));
    assert.equal(
      cnt2.toString(),
      `<p class="a" style="color: red;">text<slot name="slot1"></slot></p>`
    );

    root.appendChild(cnt2);
    assert.equal(
      root.toString(),
      `<html>` +
        `<template id="tpl"><p class="a" style="color: red;">text<slot name="slot1"></slot></p></template>` +
        `<p class="a" style="color: red;">text<slot name="slot1"></slot></p>` +
        `</html>`
    );
  });

  it('should support cloning nested template content', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;

    const tpl1 = root.appendChild(
      new ServerTemplateElement(doc, LOC)
    ) as TemplateElement;
    tpl1.setAttribute('id', 'tpl1');
    const p1 = tpl1.appendChild(new ServerElement(doc, 'p', LOC)) as Element;
    p1.setAttribute('a', '1');
    p1.appendChild(new ServerText(doc, 'text1', LOC));
    const slot1 = p1.appendChild(
      new ServerElement(doc, 'slot', LOC)
    ) as Element;
    slot1.setAttribute('name', 'slot1');

    const tpl2 = tpl1.appendChild(
      new ServerTemplateElement(doc, LOC)
    ) as TemplateElement;
    tpl2.setAttribute('id', 'tpl2');
    const p2 = tpl2.appendChild(new ServerElement(doc, 'p', LOC)) as Element;
    p2.setAttribute('a', '2');
    p2.appendChild(new ServerText(doc, 'text2', LOC));
    const slot2 = p2.appendChild(
      new ServerElement(doc, 'slot', LOC)
    ) as Element;
    slot2.setAttribute('name', 'slot2');

    assert.equal(
      root.toString(),
      `<html>` +
        `<template id="tpl1">` +
        `<p a="1">text1<slot name="slot1"></slot></p>` +
        `<template id="tpl2"><p a="2">text2<slot name="slot2"></slot></p></template>` +
        `</template>` +
        `</html>`
    );

    const clone1 = tpl1.cloneNode(true);
    assert.isTrue(compareNode(tpl1, clone1));
    assert.equal(
      clone1.toString(),
      `<template id="tpl1">` +
        `<p a="1">text1<slot name="slot1"></slot></p>` +
        `<template id="tpl2"><p a="2">text2<slot name="slot2"></slot></p></template>` +
        `</template>`
    );
  });

  it('should support cloning nested template content', () => {
    const doc = new ServerDocument('test');
    const root = doc.appendChild(
      new ServerElement(doc, 'html', LOC)
    ) as Element;

    const tpl1 = root.appendChild(
      new ServerTemplateElement(doc, LOC)
    ) as TemplateElement;
    tpl1.setAttribute('id', 'tpl1');
    const p1 = tpl1.appendChild(new ServerElement(doc, 'p', LOC)) as Element;
    p1.setAttribute('a', '1');
    p1.appendChild(new ServerText(doc, 'text1', LOC));
    const slot1 = p1.appendChild(
      new ServerElement(doc, 'slot', LOC)
    ) as Element;
    slot1.setAttribute('name', 'slot1');

    const tpl2 = tpl1.appendChild(
      new ServerTemplateElement(doc, LOC)
    ) as TemplateElement;
    tpl2.setAttribute('id', 'tpl2');
    const p2 = tpl2.appendChild(new ServerElement(doc, 'p', LOC)) as Element;
    p2.setAttribute('a', '2');
    p2.appendChild(new ServerText(doc, 'text2', LOC));
    const slot2 = p2.appendChild(
      new ServerElement(doc, 'slot', LOC)
    ) as Element;
    slot2.setAttribute('name', 'slot2');

    assert.equal(
      root.toString(),
      `<html>` +
        `<template id="tpl1">` +
        `<p a="1">text1<slot name="slot1"></slot></p>` +
        `<template id="tpl2"><p a="2">text2<slot name="slot2"></slot></p></template>` +
        `</template>` +
        `</html>`
    );

    const clone1 = tpl1.content.cloneNode(true);
    assert.equal(
      clone1.toString(),
      `<p a="1">text1<slot name="slot1"></slot></p>` +
        `<template id="tpl2"><p a="2">text2<slot name="slot2"></slot></p></template>`
    );
    root.appendChild(clone1);
    assert.equal(
      root.toString(),
      `<html>` +
        `<template id="tpl1">` +
        `<p a="1">text1<slot name="slot1"></slot></p>` +
        `<template id="tpl2"><p a="2">text2<slot name="slot2"></slot></p></template>` +
        `</template>` +
        `<p a="1">text1<slot name="slot1"></slot></p>` +
        `<template id="tpl2"><p a="2">text2<slot name="slot2"></slot></p></template>` +
        `</html>`
    );

    const tpl2b = root.childNodes.find(
      n =>
        n.nodeType === NodeType.ELEMENT &&
        (n as Element).getAttribute('id') === 'tpl2'
    ) as TemplateElement;
    const clone2 = tpl2b.content.cloneNode(true);
    assert.equal(
      clone2.toString(),
      `<p a="2">text2<slot name="slot2"></slot></p>`
    );
    root.appendChild(clone2);
    assert.equal(
      root.toString(),
      `<html>` +
        `<template id="tpl1">` +
        `<p a="1">text1<slot name="slot1"></slot></p>` +
        `<template id="tpl2"><p a="2">text2<slot name="slot2"></slot></p></template>` +
        `</template>` +
        `<p a="1">text1<slot name="slot1"></slot></p>` +
        `<template id="tpl2"><p a="2">text2<slot name="slot2"></slot></p></template>` +
        `<p a="2">text2<slot name="slot2"></slot></p>` +
        `</html>`
    );
  });
});

function compareContainer(a: ServerContainerNode, b: ServerContainerNode) {
  // containers only need to compare children (no attributes)
  if (a.childNodes.length !== b.childNodes.length) return false;
  for (let i = 0; i < a.childNodes.length; i++) {
    const an = a.childNodes[i] as ServerNode;
    const bn = b.childNodes[i] as ServerNode;
    if (!compareNode(an, bn)) return false;
  }
  return true;
}

function compareNode(na: Node, nb: Node) {
  const a = na as unknown as ServerNode;
  const b = nb as unknown as ServerNode;
  if ((a != null) !== (a != null)) return false;
  if (a === b) return false;
  if (!a) return true;
  if (a.nodeType !== b.nodeType) return false;
  switch (a.nodeType) {
    case NodeType.ELEMENT:
    case NodeType.DOCUMENT:
      return compareElement(a as ServerElement, b as ServerElement);
    case NodeType.DOCUMENT_FRAGMENT:
      return compareContainer(
        a as ServerContainerNode,
        b as ServerContainerNode
      );
    case NodeType.TEXT:
    case NodeType.COMMENT:
      return compareText(a as ServerText, b as ServerText);
    default:
      return false;
  }
}

function compareElement(a: ServerElement, b: ServerElement) {
  if (a.tagName !== b.tagName) return false;
  // attributes
  if (a.attributes.length !== b.attributes.length) return false;
  for (const aa of a.attributes) {
    const ba = b.getAttributeNode(aa.name);
    if (!ba || aa === ba) return false;
    if (aa.value !== ba.value) return false;
  }
  // children
  if (a.childNodes.length !== b.childNodes.length) return false;
  for (let i = 0; i < a.childNodes.length; i++) {
    const an = a.childNodes[i] as ServerNode;
    const bn = b.childNodes[i] as ServerNode;
    if (!compareNode(an, bn)) return false;
  }
  return true;
}

function compareText(a: Text, b: Text) {
  return a.textContent === b.textContent;
}
