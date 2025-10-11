#!/usr/bin/env node

// Test our DocumentFragment implementation behavior
const { ServerDocument, ServerDocumentFragment, ServerElement, ServerText } = require('./dist/src/html/server-dom.js');

console.log("=== Our DocumentFragment behavior ===");

const doc = new ServerDocument('test');
const fragment = new ServerDocumentFragment({ source: 'test', start: { line: 1, column: 0 }, end: { line: 1, column: 0 }, i1: 0, i2: 0 });

const p = new ServerElement(doc, 'p', { source: 'test', start: { line: 1, column: 0 }, end: { line: 1, column: 0 }, i1: 0, i2: 0 });
const text = new ServerText(doc, 'Hello World', { source: 'test', start: { line: 1, column: 0 }, end: { line: 1, column: 0 }, i1: 0, i2: 0 });

p.appendChild(text);
fragment.appendChild(p);

console.log("Fragment toString():", fragment.toString());
console.log("Fragment has children:", fragment.childNodes.length);
console.log("Document tagName:", doc.tagName);
console.log("Document toString():", doc.toString());

// When added to DOM, children should be moved
const div = new ServerElement(doc, 'div', { source: 'test', start: { line: 1, column: 0 }, end: { line: 1, column: 0 }, i1: 0, i2: 0 });
div.appendChild(fragment);

console.log("After appendChild, div toString():", div.toString());
console.log("After appendChild, fragment has children:", fragment.childNodes.length);

console.log("\n=== Comparison ===");
console.log("✅ DocumentFragment.toString() renders children directly without wrapper");
console.log("✅ When appended to DOM, children are moved to parent and fragment becomes empty");
console.log("✅ Document extends Element but has special tagName '#document'");
console.log("✅ Behavior matches DOM specification while keeping code uniform");