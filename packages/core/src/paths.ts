import path from 'path';
import { findPackage, Kit, KIT_KEY } from './kits';

/**
 * Where a logical pathname is allowed to land, and what it maps to.
 *
 * Four places used to answer this question, each with its own arithmetic and
 * its own containment check: the preprocessor deciding whether an
 * `<:include>` may read a file, the middleware deciding whether a request
 * names a page, and `build`'s walk and copy. Two of them carried
 * near-identical comments warning about the same hazard, which is the usual
 * sign that one of them will be fixed and the others will not.
 *
 * With kits installed from npm there is a second reason: a kit's files live
 * outside the docroot and are addressed as though they sat inside it, so
 * "is this path allowed" stops being a test against one constant and becomes
 * a test against whichever root the path resolved into. See docs/design/npm-kits.md.
 */

/**
 * How a kit's files are addressed at COMPILE time, and only then.
 *
 * `<:import src="/npm/@markout/bootstrap-kit/all.htm" />` names a package,
 * which is the one place provenance is worth stating. Everything else -- and
 * everything that survives into the served page -- speaks in the kit's
 * logical root, because that is the only thing a URL can mean. Two spellings,
 * one job each: this one never appears in output and is never servable.
 */
export const NPM_PREFIX = '/npm/';

/** Path separators to forward slashes, so a pathname reads the same anywhere. */
export function normalizeSeparators(filepath: string): string {
  return filepath.replace(/\\/g, '/');
}

/**
 * A directory that logical pathnames may resolve into.
 *
 * `prefix` is what a page writes; `dir` is where that lives. The docroot is
 * the root whose prefix is `/`, and every other root is a kit's.
 */
export interface Root {
  prefix: string;
  dir: string;
  /** absent for the docroot */
  kit?: Kit;
}

export type Resolution =
  | {
      ok: true;
      root: Root;
      /** absolute filesystem path */
      filePath: string;
      /**
       * The logical pathname: forward slashes, leading `/`, and always
       * expressed through the root it belongs to. A `/npm/...` spec comes
       * back as the kit's own `/bootstrap-kit/...`, so a file has ONE
       * logical identity however it was addressed -- which is what lets
       * `<:import>`'s once-only rule work across both spellings.
       */
      pathname: string;
    }
  | {
      ok: false;
      kind: 'forbidden';
      /**
       * How the path escaped, relative to the root it was measured against
       * -- `../site-secret/passwd.html` and not an absolute path, because
       * this reaches an author in an error message and the part they can act
       * on is the part they wrote.
       */
      escaped: string;
    }
  | { ok: false; kind: 'unresolved'; message: string };

export class Resolver {
  readonly docroot: Root;
  /** kit roots, longest prefix first, with the docroot last as the catch-all */
  readonly roots: Root[];
  private byDir = new Map<string, Root>();

  constructor(docroot: string, kits: Kit[] = []) {
    this.docroot = { prefix: '/', dir: path.resolve(docroot) };
    this.roots = kits
      .map(kit => ({ prefix: kit.root, dir: kit.dir, kit }))
      .sort((a, b) => b.prefix.length - a.prefix.length);
    this.roots.forEach(r => this.byDir.set(r.dir, r));
    this.roots.push(this.docroot);
  }

  /**
   * Resolve `spec` -- an author's pathname, absolute or relative -- against
   * `currDir`, and refuse it if it leaves the root it belongs to.
   *
   * `currDir` is ignored for an absolute spec, which is what makes a leading
   * slash mean "from the root" rather than "from the filesystem".
   */
  resolve(spec: string, currDir = ''): Resolution {
    const s = normalizeSeparators(spec);
    if (s === NPM_PREFIX.slice(0, -1) || s.startsWith(NPM_PREFIX)) {
      return this.resolveNpm(s, currDir);
    }
    const { pathname, escape } = normalizeLogical(
      s.startsWith('/') ? s : `${currDir}/${s}`
    );
    if (escape > 0) {
      // rebuilt in the author's terms rather than reported as an absolute
      // path, so the message names what they wrote
      return {
        ok: false,
        kind: 'forbidden',
        escaped: '../'.repeat(escape) + pathname.substring(1),
      };
    }
    const root = this.rootFor(pathname);
    const rest = pathname.substring(root.prefix === '/' ? 1 : root.prefix.length + 1);
    const filePath = rest ? path.join(root.dir, ...rest.split('/')) : root.dir;
    // belt and braces: normalizeLogical has already refused every escape, so
    // this can only fire if a segment means something to the platform that it
    // does not mean here
    if (!contains(root.dir, filePath)) {
      return { ok: false, kind: 'forbidden', escaped: pathname };
    }
    return { ok: true, root, filePath, pathname };
  }

  /** the root a logical pathname belongs to; the docroot if no kit claims it */
  rootFor(pathname: string): Root {
    return (
      this.roots.find(
        r =>
          r.prefix === '/' ||
          pathname === r.prefix ||
          pathname.startsWith(r.prefix + '/')
      ) ?? this.docroot
    );
  }

  /**
   * `/npm/<package>/<file>` -- a package by name, resolved from the
   * IMPORTING file's location rather than the application's root, so that a
   * kit importing another kit finds the copy npm installed for it.
   *
   * The answer is handed straight back to `resolve` in the kit's own terms,
   * which gives normalization, containment and a single logical identity for
   * free.
   */
  private resolveNpm(spec: string, currDir: string): Resolution {
    const rest = spec.substring(NPM_PREFIX.length);
    const parts = rest.split('/').filter(s => s);
    const named = parts[0]?.startsWith('@') ? 2 : 1;
    if (parts.length < named) {
      return {
        ok: false,
        kind: 'unresolved',
        message: `"${spec}" names no package`,
      };
    }
    const name = parts.slice(0, named).join('/');
    const within = parts.slice(named).join('/');
    const dir = findPackage(name, this.dirOf(currDir));
    if (!dir) {
      return {
        ok: false,
        kind: 'unresolved',
        message: `Cannot find package "${name}" -- is it installed?`,
      };
    }
    const root = this.byDir.get(dir);
    if (!root) {
      return {
        ok: false,
        kind: 'unresolved',
        message:
          `Package "${name}" is installed but is not a mounted kit -- it ` +
          `either declares no ${KIT_KEY}.root, or its root was refused`,
      };
    }
    return this.resolve(within ? `${root.prefix}/${within}` : root.prefix);
  }

  /** the filesystem directory a logical directory names */
  private dirOf(currDir: string): string {
    if (!currDir || currDir.startsWith(NPM_PREFIX)) {
      return this.docroot.dir;
    }
    const at = this.resolve(currDir);
    return at.ok ? at.filePath : this.docroot.dir;
  }
}

/**
 * A logical pathname reduced to plain segments, plus how far it climbed out
 * of its root.
 *
 * Done by hand rather than with `path.posix.normalize`, and the escape count
 * is why: `normalize('/../secret')` is `/secret`, so normalizing would
 * quietly reinterpret an escape as an ordinary lookup that happens to find
 * nothing -- trading a refusal that names the mistake for a 404 that does
 * not. Both answers are needed at once. The normalized form is what mount
 * prefixes are matched against, so that `/foo/../bootstrap-kit/res/x.png`
 * finds the mount it plainly names instead of falling through to the
 * docroot; the count is what refuses `/../secret` all the same.
 */
export function normalizeLogical(p: string): { pathname: string; escape: number } {
  const out: string[] = [];
  let escape = 0;
  for (const segment of p.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      out.length ? out.pop() : escape++;
      continue;
    }
    out.push(segment);
  }
  return { pathname: '/' + out.join('/'), escape };
}

/**
 * Whether `candidate` is `dir` or sits below it.
 *
 * The trailing separator is the whole point: a plain `startsWith(dir)` also
 * matches a sibling directory sharing the prefix, so a docroot of `/a/site`
 * would accept `/a/site-other/secret`. That hazard gets more load-bearing
 * with kits, not less -- in `node_modules`, `@markout/bootstrap-kit` and a
 * `@markout/bootstrap-kit-extras` are literal directory siblings.
 *
 * Lexical, and that is a decision rather than an oversight. It answers "did
 * this path escape its root", not "these bytes came from inside that
 * directory" -- symlinks are not followed, because under pnpm every
 * installed package IS a symlink into a store outside the project, so a
 * `realpath`-based test would refuse every legitimate install. `build`'s
 * walk does call `realpath`, correctly, but for cycle detection and not for
 * this.
 */
export function contains(dir: string, candidate: string): boolean {
  return candidate === dir || candidate.startsWith(dir + path.sep);
}
