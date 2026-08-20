import { referencesTo, type Page, type Scope, type Value } from '@markout-lang/core';
import fs from 'fs';
import path from 'path';
import type { Range } from './diagnostics';
import { declarationTargetAt } from './declarations';

/**
 * Everywhere a value or a scope is read.
 *
 * The reverse of go-to-definition, and worth having for the same reason
 * renaming is: a name in this language belongs to a scope, so "who reads
 * this" cannot be answered by searching for the word. Two `title`s in two
 * definitions are different things, and a `body.items` two files away is the
 * same thing under another spelling.
 *
 * `referencesTo` in core answers which EXPRESSIONS read it. What is added
 * here is where inside each expression the name is written, since that is
 * what an editor underlines -- and the compiler has no reason to record it,
 * an expression being a single thing as far as compiling is concerned.
 */

export interface ReferenceSite {
  pathname: string;
  range: Range;
}

export interface ReferencesProps {
  docroot: string;
  pathname: string;
  text: string;
  offset: number;
  open?: (filePath: string) => string | undefined;
  /** include the declaration itself, which is what an editor usually wants */
  includeDeclaration?: boolean;
}

export async function findReferences(props: ReferencesProps): Promise<ReferenceSite[]> {
  const found = await declarationTargetAt(props);
  if (!found) {
    return [];
  }
  const { page, target } = found;
  const sites: ReferenceSite[] = [];

  if (props.includeDeclaration !== false) {
    const loc = declarationLoc(target);
    if (loc) {
      sites.push({
        pathname: loc.source ?? props.pathname,
        range: {
          start: { line: loc.start.line - 1, character: loc.start.column },
          end: { line: loc.end.line - 1, character: loc.end.column },
        },
      });
    }
  }

  for (const reference of referencesTo(page, target)) {
    sites.push(...spellingsOf(reference.from, reference.key, props));
  }
  return sites;
}

function declarationLoc(target: Value | Scope) {
  return 'node' in target ? target.node.loc : target.e?.loc;
}

/**
 * Where a name is written inside one expression.
 *
 * The expression's own range is all the compiler kept, and underlining a
 * whole attribute to say "the word `items` is used here" is the kind of
 * answer that makes a feature feel approximate. So its source is sliced back
 * out and the name found in it -- more than once, if it is read more than
 * once, which a single range could not have said at all.
 */
function spellingsOf(from: Value, key: string, props: ReferencesProps): ReferenceSite[] {
  const loc = from.node.loc;
  const pathname = loc.source ?? props.pathname;
  const text = fileText(pathname, props);
  if (text === undefined) {
    return [];
  }
  const source = text.slice(loc.i1, loc.i2);
  const sites: ReferenceSite[] = [];
  // A word, not a substring: `item` must not match inside `items`. A dot
  // BEFORE it is fine, and excluding one was a mistake worth naming --
  // `body.items` is written with a dot and is the commonest way to read a
  // value that is not in the nearest scope. Whether it refers to the target
  // was settled by resolving it; this only has to find where it is written.
  const word = new RegExp(`(?<![\\w$])${escape(key)}(?![\\w$])`, 'g');
  for (const match of source.matchAll(word)) {
    sites.push({ pathname, range: rangeAt(text, loc.i1 + match.index, key.length) });
  }
  return sites;
}

/** an offset and a length, as lines and characters */
function rangeAt(text: string, at: number, length: number): Range {
  const before = text.slice(0, at);
  const line = before.split('\n').length - 1;
  const character = at - (before.lastIndexOf('\n') + 1);
  return {
    start: { line, character },
    end: { line, character: character + length },
  };
}

function escape(name: string) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fileText(pathname: string, props: ReferencesProps): string | undefined {
  if (pathname === props.pathname) {
    return props.text;
  }
  const filePath = path.join(props.docroot, pathname);
  const buffer = props.open?.(filePath);
  if (buffer !== undefined) {
    return buffer;
  }
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

export type { Page };
