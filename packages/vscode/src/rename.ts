import { referencesTo, type Page, type Scope, type Value } from '@markout/core';
import fs from 'fs';
import path from 'path';
import { declarationTargetAt, identifierAt } from './declarations';
import type { Range } from './diagnostics';
import { compileFileFor, compilePage, pagesUnder } from './pages';

/**
 * Renaming a value, a scope or a parameter, everywhere it is written.
 *
 * Two things make this more than find-references with an edit attached.
 *
 * The first is that references stop at a page. `referencesTo` answers about
 * one compiled page, and a definition lives in a fragment that any number of
 * pages import -- so a rename that only looked where the cursor is would
 * quietly break every other page. Every page under the docroot is compiled,
 * and the target is matched across those compiles by WHERE IT IS DECLARED,
 * since the objects differ per compile but the file and offset do not.
 *
 * The second is that a definition's parameter is passed at every usage site,
 * and a usage site does not READ it -- it declares a value of its own that
 * the definition then reads. Those attributes are not references and
 * `referencesTo` is right not to return them, but they carry the name and
 * have to be renamed too, or the parameter silently stops being passed.
 */

export interface Edit {
  pathname: string;
  range: Range;
}

export interface RenameProps {
  docroot: string;
  pathname: string;
  text: string;
  offset: number;
  open?: (filePath: string) => string | undefined;
}

/** the word that would be renamed, so an editor can offer it */
export async function prepareRename(
  props: RenameProps
): Promise<{ range: Range; name: string } | undefined> {
  const name = identifierAt(props.text, props.offset);
  if (!name) {
    return undefined;
  }
  const found = await declarationTargetAt(props);
  if (!found || !identityOf(found.target)) {
    return undefined;
  }
  let start = props.offset;
  while (start > 0 && /[A-Za-z0-9_$]/.test(props.text[start - 1])) start--;
  return { range: rangeAt(props.text, start, name.length), name };
}

/** every place the name is written, across every page that can see it */
export async function renameEdits(props: RenameProps): Promise<Edit[]> {
  const found = await declarationTargetAt(props);
  const identity = found && identityOf(found.target);
  const name = found && nameOf(found.target);
  if (!identity || !name) {
    return [];
  }

  const edits = new Map<string, Edit>();
  const add = (pathname: string, at: number, text: string) => {
    const edit = { pathname, range: rangeAt(text, at, name.length) };
    edits.set(`${pathname}:${at}`, edit);
  };
  const addReferences = (page: Page, of: Value | Scope) => {
    for (const reference of referencesTo(page, of)) {
      const loc = reference.from.node.loc;
      const pathname = loc.source ?? props.pathname;
      const text = fileText(pathname, props);
      if (text === undefined) {
        continue;
      }
      const word = new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`, 'g');
      for (const match of text.slice(loc.i1, loc.i2).matchAll(word)) {
        add(pathname, loc.i1 + match.index, text);
      }
    }
  };

  for (const page of await everyPage(props)) {
    const target = matching(page, identity);
    if (!target) {
      continue;
    }
    // where it is declared
    const declared = declaringLoc(target);
    const declaredIn = declared?.source ?? props.pathname;
    const declaringText = declared && fileText(declaredIn, props);
    if (declared && declaringText !== undefined) {
      const at = nameWithin(declaringText, declared.i1, declared.i2, name);
      at === undefined || add(declaredIn, at, declaringText);
    }
    // where it is read
    addReferences(page, target);
    // And, for a definition's parameter, where it is PASSED -- plus what
    // reads it through the instance. `<x-card :aka="intro" :title=…>` gives
    // the page an `intro.title` to read, and that read resolves to the value
    // the USAGE declared rather than to the parameter, so it is a second
    // target rather than another reference to the first. Missing it renamed
    // three sites out of four and left the page not compiling.
    for (const usage of usagesPassing(page, target, name, props)) {
      const loc = usage.node.loc;
      const pathname = loc.source ?? props.pathname;
      const text = fileText(pathname, props);
      if (text === undefined) {
        continue;
      }
      const at = nameWithin(text, loc.i1, loc.i2, name);
      at === undefined || add(pathname, at, text);
      addReferences(page, usage);
    }
  }
  return [...edits.values()];
}

/**
 * Every page that could see the target, compiled.
 *
 * All of them, because which ones import a given fragment is exactly what is
 * not known until they are compiled -- and a rename that missed one would
 * leave a page passing a parameter by a name nothing declares any more.
 * Expensive, and the right price for an edit that cannot be half done.
 */
async function everyPage(props: RenameProps): Promise<Page[]> {
  const found: Page[] = [];
  // the file in front of us first, compiled the way it is used -- a fragment
  // in a docroot with no pages at all is still somewhere a rename happens,
  // and a kit is exactly that: fragments and nothing else
  const here = await compileFileFor(props);
  here && found.push(here.page);
  for (const file of pagesUnder(props.docroot)) {
    const pathname = '/' + path.relative(props.docroot, file).split(path.sep).join('/');
    const text = fileText(pathname, props);
    if (text === undefined) {
      continue;
    }
    const page = await compilePage({
      docroot: props.docroot,
      pathname,
      text,
      readFile: async filePath => {
        const buffer = props.open?.(filePath);
        if (buffer !== undefined) {
          return buffer;
        }
        try {
          return await fs.promises.readFile(filePath, 'utf8');
        } catch {
          return undefined;
        }
      },
    });
    page && found.push(page);
  }
  return found;
}

/**
 * What identifies a target across compiles: the file and offset it is
 * declared at.
 *
 * Object identity cannot travel -- every page compiles its own copy of an
 * imported definition -- and a name cannot either, since a name is the very
 * thing in question. Where it is written is the one thing both compiles
 * agree on.
 */
function identityOf(target: Value | Scope): string | undefined {
  const loc = declaringLoc(target);
  return loc?.source ? `${loc.source}:${loc.i1}` : undefined;
}

function matching(page: Page, identity: string): Value | Scope | undefined {
  for (const value of page.values.values()) {
    if (identityOf(value) === identity) {
      return value;
    }
  }
  for (const scope of everyScope(page)) {
    if (identityOf(scope) === identity) {
      return scope;
    }
  }
  return undefined;
}

function* everyScope(page: Page): Generator<Scope> {
  const walk = function* (scope: Scope): Generator<Scope> {
    yield scope;
    for (const child of scope.children) {
      yield* walk(child);
    }
  };
  yield* walk(page.global);
}

/**
 * The attributes that PASS this parameter, at every usage of its tag.
 *
 * Whose usage a scope is cannot be read off `usesTemplate`: that holds a
 * stencil built per usage, not the definition's own id. What settles it is
 * the tag the author wrote -- the attribute's position is the compiler's,
 * and the name of the tag it sits in is three characters of text away.
 *
 * A first attempt asked whether the instance still carried any value
 * declared inside the `<:define>`, which is true right up until a usage
 * passes every parameter there is -- and a definition with one parameter is
 * the commonest kind.
 */
function* usagesPassing(
  page: Page,
  target: Value | Scope,
  name: string,
  props: RenameProps
): Generator<Value> {
  if (!('node' in target)) {
    return;
  }
  const tag = [...page.customTags.entries()].find(
    ([, scope]) => scope.values.get(name) === target
  )?.[0];
  if (!tag) {
    return;
  }
  for (const scope of everyScope(page)) {
    if (scope.usesTemplate === undefined || !scope.callSiteValues?.has(name)) {
      continue;
    }
    const value = scope.values.get(name);
    const loc = value?.node.loc;
    if (!value || !loc) {
      continue;
    }
    const text = fileText(loc.source ?? props.pathname, props);
    if (text && tagNameBefore(text, loc.i1) === tag) {
      yield value;
    }
  }
}

/** the tag an attribute at `offset` belongs to */
function tagNameBefore(text: string, offset: number): string | undefined {
  const open = text.lastIndexOf('<', offset);
  if (open < 0 || text.lastIndexOf('>', offset) > open) {
    return undefined;
  }
  return /^<([A-Za-z][\w-]*)/.exec(text.slice(open, offset))?.[1];
}

function declaringLoc(target: Value | Scope) {
  return 'node' in target ? target.node.loc : target.e?.loc;
}

function nameOf(target: Value | Scope): string | undefined {
  return 'node' in target ? target.name : target.name;
}

/** the offset of `name` inside a declaration, which is written `:name=…` */
function nameWithin(
  text: string,
  from: number,
  to: number,
  name: string
): number | undefined {
  const word = new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`);
  const match = word.exec(text.slice(from, to));
  return match ? from + match.index : undefined;
}

function rangeAt(text: string, at: number, length: number): Range {
  const before = text.slice(0, at);
  const line = before.split('\n').length - 1;
  const character = at - (before.lastIndexOf('\n') + 1);
  return { start: { line, character }, end: { line, character: character + length } };
}

function escape(name: string) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fileText(pathname: string, props: RenameProps): string | undefined {
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
