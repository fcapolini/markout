import type {
  CodeMapping,
  IScriptSnapshot,
  LanguagePlugin,
  VirtualCode,
} from '@volar/language-core';
import type { URI } from 'vscode-uri';
import { findExpressions } from './expressions';

/**
 * The Volar language plugin: one markout page, as the embedded documents an
 * editor already knows how to work with.
 *
 * This is the part of the extension that is not boilerplate. Volar's model
 * is that a plugin owns the MAPPING and nothing else: it produces virtual
 * code with offsets pointing back at the source, and the language features
 * come from services that already exist — HTML's, CSS's, TypeScript's. So
 * what has to be right here is the arithmetic, and only that.
 *
 * A page becomes two kinds of embedded code:
 *
 *   html   the whole file, with every `${…}` masked to characters that
 *          cannot end an attribute or a tag. Offsets are preserved exactly,
 *          so the mapping is the identity and the HTML service's answers
 *          need no translation at all.
 *
 *   js     one per expression, holding just what is between the braces.
 *
 * The masking is what makes the first one work. `:count=${a > b}` handed to
 * an HTML parser unmasked ends the tag at the `>`, and everything after it
 * is parsed as text — so the author would get attribute completion in the
 * wrong half of their file. Replacing the expression with `_` of the same
 * length keeps every later offset identical, which is worth more than
 * anything the HTML service could tell us about those few characters.
 *
 * No service is attached to the `js` codes yet, deliberately: an expression
 * resolves against the scope chain the compiler computes, not against the
 * file's lexical scope, so types need generated code that models the chain.
 * See docs/design/editor-support.md. The mapping is built now because it is
 * what that work will stand on, and because it is testable today.
 */

/**
 * The language id a markout page is opened as: `html`, and deliberately not
 * one of our own.
 *
 * A `contributes.languages` entry claiming `.html` would REPLACE the HTML
 * language rather than extend it, and VS Code gives a file exactly one
 * language -- so every HTML file on the machine would lose Emmet, the built-in
 * IntelliSense, and every extension registered against `html`. Markout is an
 * extension to HTML; its editor support has to be one too. See
 * docs/design/editor-support.md.
 */
export const PAGE_LANGUAGE_ID = 'html';

/** the character an expression is masked with in the embedded HTML */
const MASK = '_';

export function createMarkoutLanguagePlugin(): LanguagePlugin<URI> {
  return {
    getLanguageId(uri) {
      return isPage(uri.path) ? PAGE_LANGUAGE_ID : undefined;
    },

    createVirtualCode(_uri, languageId, snapshot) {
      if (languageId !== PAGE_LANGUAGE_ID) {
        return undefined;
      }
      return createRootCode(snapshot);
    },
  };
}

/** the files this plugin claims: pages, and the fragments they import */
export function isPage(pathOrName: string): boolean {
  return /\.(html?|htm)$/i.test(pathOrName);
}

function createRootCode(snapshot: IScriptSnapshot): VirtualCode {
  const text = snapshot.getText(0, snapshot.getLength());
  return {
    id: 'root',
    languageId: 'markout',
    snapshot,
    // the source stands for itself: everything the extension's own services
    // answer (diagnostics, go-to-file) is in the page's own coordinates
    mappings: [wholeFile(text.length)],
    embeddedCodes: [htmlCode(text), ...expressionCodes(text)],
  };
}

/** the page with its expressions masked, offset for offset */
function htmlCode(text: string): VirtualCode {
  const masked = text.split('');
  for (const e of findExpressions(text)) {
    for (let i = e.start; i < e.end; i++) {
      // newlines survive the mask so that line numbers, and every multi-line
      // construct an HTML parser cares about, stay where the author put them
      if (masked[i] !== '\n' && masked[i] !== '\r') {
        masked[i] = MASK;
      }
    }
  }
  const generated = masked.join('');
  return {
    id: 'html',
    languageId: 'html',
    snapshot: snapshotOf(generated),
    mappings: [wholeFile(text.length)],
  };
}

/** one embedded JavaScript document per `${…}` */
function expressionCodes(text: string): VirtualCode[] {
  return findExpressions(text).map((e, i) => ({
    id: `expression_${i}`,
    languageId: 'javascript',
    snapshot: snapshotOf(e.text),
    mappings: [
      {
        sourceOffsets: [e.contentStart],
        generatedOffsets: [0],
        lengths: [e.text.length],
        data: {
          completion: true,
          format: false,
          navigation: true,
          semantic: true,
          structure: true,
          // nothing type-checks these yet, and a service that did would
          // report every scope value as undefined -- see the file comment
          verification: false,
        },
      },
    ],
  }));
}

/** the identity mapping: generated code that is the source, offset for offset */
function wholeFile(length: number): CodeMapping {
  return {
    sourceOffsets: [0],
    generatedOffsets: [0],
    lengths: [length],
    data: {
      completion: true,
      format: true,
      navigation: true,
      semantic: true,
      structure: true,
      verification: true,
    },
  };
}

export function snapshotOf(text: string): IScriptSnapshot {
  return {
    getText: (start, end) => text.slice(start, end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}
