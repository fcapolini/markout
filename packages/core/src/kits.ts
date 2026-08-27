import fs from 'fs';
import path from 'path';
import { findManifest, KITS_DIR } from './manifest';

/**
 * Kits installed as npm packages, and where each one says it lives.
 *
 * A kit is a package whose `package.json` carries a `markout.root`: the
 * logical pathname under which everything it publishes is addressed, as
 * though the package sat there in the docroot.
 *
 *     "markout": { "root": "/bootstrap-kit" }
 *
 * The declaration is mandatory and is not derived from the package name.
 * npm guarantees the FULL name is unique and scopes exist so the unscoped
 * part need not be, so `@markout-lang/bootstrap-kit` and `@acme/bootstrap-kit`
 * would derive the same root while being a perfectly legal pair to install;
 * and a kit vendored into a docroot has no package name left to derive from,
 * while still needing the identity its own files refer to. See docs/design/npm-kits.md.
 *
 * The whole design is held to one test: everything behaves as though, having
 * installed the kit, you had made a symlink to it from the docroot under its
 * logical name. That is why the refusals below are refusals rather than a
 * precedence rule -- `ln -s` fails when the name is taken, and every case
 * here is that failure reached by a different route.
 */

/** the `package.json` key a kit declares itself with */
export const KIT_KEY = 'markout';

/**
 * A logical root is one or more plain path segments. Multiple are allowed so
 * that a kit can stay out of the top level (`/vendor/bs-kit`) and reduce the
 * chance of squatting a name the application wanted; `/` itself is refused,
 * as is anything with `.`/`..` or an empty segment in it.
 */
const ROOT_RE = /^(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;

export interface Kit {
  /** package name, e.g. `@markout-lang/bootstrap-kit` */
  name: string;
  /** absolute path of the package directory */
  dir: string;
  /** declared logical root, e.g. `/bootstrap-kit` */
  root: string;
  /** its `package.json` version, when it declares one */
  version?: string;
  /**
   * Whether it was found in `.markout/kits` rather than in a `node_modules`.
   *
   * Nothing about compiling or serving the kit depends on this -- that is the
   * point of laying the two directories out alike. It exists so the manifest
   * can hold the copy it installed to its pin without also holding npm's
   * copies to it, npm's versions being npm's business and its own file's.
   */
  managed?: boolean;
}

export interface Discovery {
  kits: Kit[];
  /** refusals, each already a complete sentence for a log or a build report */
  errors: string[];
}

/**
 * Every installed kit reachable from `docroot`, and every reason to refuse
 * one.
 *
 * Derived from what is INSTALLED, never from what some page imported. The
 * server has no choice -- a request for `/bootstrap-kit/res/logo.png` has to
 * resolve before any page has been compiled -- and the build follows the
 * same rule so that the two cannot disagree. Deriving the build's copy from
 * imports would be easy and precise and would produce a deliverable in which
 * a resource referenced by a page that did not import its kit 404s, having
 * worked in dev.
 *
 * Installed means `node_modules` or `.markout/kits`, at the docroot and at
 * every directory above it. The second rung is what makes a kit reachable
 * without npm, and it is on the same walk on purpose -- see `KITS_DIR`.
 */
export function discoverKits(
  docroot: string,
  alsoFrom: string[] = []
): Discovery {
  const root = path.resolve(docroot);
  const kits: Kit[] = [];
  const errors: string[] = [];
  const byRoot = new Map<string, Kit>();
  const seenDir = new Set<string>();

  const consider = (name: string, dir: string, managed = false) => {
    if (seenDir.has(dir)) {
      return;
    }
    seenDir.add(dir);
    const declared = readKitRoot(name, dir, errors);
    if (!declared) {
      return;
    }
    const clash = byRoot.get(declared.root);
    if (clash) {
      // covers two DIFFERENT kits claiming one root and two copies of one
      // kit claiming theirs, which npm's nested installs make a legal tree
      // and `.markout/kits` beside a `node_modules` makes an easy mistake;
      // a site cannot serve two versions of a kit's assets at one URL either
      // way, so there is nothing to pick between. The advice differs, which
      // is why the message does: a root is the kit author's to change, and
      // nobody can change one twice.
      errors.push(
        clash.name === name
          ? `kit "${name}" is installed twice -- at "${clash.dir}" and at ` +
              `"${dir}", both claiming root "${declared.root}" -- remove one`
          : `kit "${name}" claims root "${declared.root}", already claimed by ` +
              `"${clash.name}" -- one of them must declare a different ` +
              `${KIT_KEY}.root`
      );
      return;
    }
    const shadowed = path.join(root, declared.root);
    if (fs.existsSync(shadowed)) {
      errors.push(
        `kit "${name}" claims root "${declared.root}", but the docroot already ` +
          `has "${shadowed}" -- preferring either one would silently hide ` +
          `the other`
      );
      return;
    }
    const kit: Kit = { name, dir, root: declared.root, version: declared.version };
    managed && (kit.managed = true);
    byRoot.set(declared.root, kit);
    kits.push(kit);
    // a kit's own dependencies may be kits: the Bootstrap kit importing the
    // std kit is the case, and under a nested install its copy lives here
    // rather than beside the application's -- or, for a kit that arrived
    // without npm, vendored into the kit's own `.markout/kits`
    for (const from of kitDirs(dir)) {
      scan(from.dir, (n, d) => consider(n, d, from.managed));
    }
  };

  for (const from of kitDirs(root, true)) {
    scan(from.dir, (n, d) => consider(n, d, from.managed));
  }
  // A bare docroot -- HTML in a directory, no package.json anywhere above it
  // -- has no project to install kits into, so the only kits its author can
  // have are the ones they installed globally. `alsoFrom` lets a caller offer
  // its OWN install tree as a last resort: walked up from a globally
  // installed CLI that reaches the global `node_modules`, and from a locally
  // installed one it reaches the project's, which the walk above already
  // covered.
  //
  // Only when the project tree yielded nothing, though. Appending it always
  // would let a real project pick up a stray global copy of a kit it already
  // has and fail the clash check above -- a build broken by an install that
  // has nothing to do with it.
  if (kits.length === 0) {
    for (const from of alsoFrom) {
      for (const dir of nodeModulesDirs(path.resolve(from))) {
        scan(dir, consider);
      }
    }
  }
  errors.push(...manifestErrors(root, kits));
  return { kits, errors };
}

/**
 * What the project asked for and has not got.
 *
 * The reason the manifest exists. Without it a missing kit is not a fact the
 * compiler has: the page compiles, the kit's tags render as unknown elements,
 * a region of the page is blank and nothing anywhere names a cause. With it
 * the compiler can say which kit, from which file, and what to run -- and
 * because this is the compiler saying it, `markout build` and CI say it too
 * rather than the editor alone. See docs/design/without-node.md.
 *
 * A kit that is installed and NOT declared is not reported. That is every
 * project that used npm, which is most of them, and a manifest that objected
 * to them would be a second dependency file competing with `package.json`.
 */
function manifestErrors(docroot: string, kits: Kit[]): string[] {
  const found = findManifest(docroot);
  if (!found) {
    return [];
  }
  const errors = [...found.errors];
  const byName = new Map(kits.map(kit => [kit.name, kit]));
  for (const [name, version] of Object.entries(found.manifest.kits)) {
    const kit = byName.get(name);
    if (!kit) {
      errors.push(
        `kit "${name}" is declared in "${found.file}" and is not ` +
          `installed -- run "markout restore" to fetch what the manifest asks for`
      );
      continue;
    }
    // Held to the pin only where the pin governs. A copy in `node_modules` is
    // npm's, its version is `package.json`'s and its lockfile's business, and
    // a second file with an opinion about it would be a conflict invented
    // here for no one's benefit.
    if (kit.managed && kit.version && kit.version !== version) {
      errors.push(
        `kit "${name}" is pinned to ${version} in "${found.file}" but ` +
          `${kit.version} is installed at "${kit.dir}" -- run ` +
          `"markout restore" to match the manifest, or "markout add ` +
          `${name}@${kit.version}" to pin what is there`
      );
    }
  }
  return errors;
}

/**
 * The directories a kit may be installed in, nearest first: `.markout/kits`
 * and `node_modules`, at `dir` and -- when `up` -- at every directory above
 * it.
 *
 * Upwards from the DOCROOT, which is the project the pages belong to -- and
 * not from the working directory, which is wherever the operator happened to
 * be standing.
 *
 * `.markout/kits` comes first at each rung. Two copies of one kit is a
 * refusal either way (see `consider`), so the order decides only which copy
 * is kept and which is named in the message; keeping the one the project
 * carries, and naming the one npm put there, matches which of the two the
 * author chose deliberately.
 */
function kitDirs(dir: string, up = false): { dir: string; managed: boolean }[] {
  const found: { dir: string; managed: boolean }[] = [];
  let current = dir;
  for (;;) {
    found.push({ dir: path.join(current, ...KITS_DIR.split('/')), managed: true });
    found.push({ dir: path.join(current, 'node_modules'), managed: false });
    const parent = path.dirname(current);
    if (!up || parent === current) {
      return found;
    }
    current = parent;
  }
}

/**
 * `node_modules` directories from `dir` upwards, nearest first.
 *
 * The install-tree walk, which is a different question from the one above:
 * it is asked of a CLI's own location to reach the global `node_modules` it
 * was installed into, where `.markout/kits` has no meaning.
 */
function nodeModulesDirs(dir: string): string[] {
  const found: string[] = [];
  let current = dir;
  for (;;) {
    found.push(path.join(current, 'node_modules'));
    const parent = path.dirname(current);
    if (parent === current) {
      return found;
    }
    current = parent;
  }
}

/**
 * Every package directly in an install directory, scoped ones included.
 *
 * One reader for `node_modules` and for `.markout/kits`, because the second
 * is deliberately laid out as the first: a package per directory, a scope as
 * a directory of them. Nothing here has to know which it is walking, and a
 * kit cannot tell how it arrived.
 */
function scan(installed: string, visit: (name: string, dir: string) => void) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(installed, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // `.bin`, `.package-lock.json` and friends are npm's, not a package's
    if (entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(installed, entry.name);
    if (entry.name.startsWith('@')) {
      let scoped: fs.Dirent[];
      try {
        scoped = fs.readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const s of scoped) {
        visit(`${entry.name}/${s.name}`, path.join(full, s.name));
      }
      continue;
    }
    visit(entry.name, full);
  }
}

/**
 * The kit's declared root, or nothing if the package is not a kit.
 *
 * A package carrying the key but no usable root is an ERROR rather than a
 * non-kit: it is a kit whose author left the declaration half-written, and
 * silently treating it as an ordinary dependency would surface later as an
 * import that cannot be resolved for no visible reason.
 */
function readKitRoot(
  name: string,
  dir: string,
  errors: string[]
): { root: string; version?: string } | undefined {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return;
  }
  const declared = json[KIT_KEY] as { root?: unknown } | undefined;
  if (!declared || typeof declared !== 'object') {
    return;
  }
  const root = declared.root;
  if (typeof root !== 'string' || !root) {
    errors.push(
      `package "${name}" has a "${KIT_KEY}" section but no ${KIT_KEY}.root -- ` +
        `add one, e.g. { "${KIT_KEY}": { "root": "${suggestRoot(name)}" } }`
    );
    return;
  }
  if (!ROOT_RE.test(root)) {
    errors.push(
      `kit "${name}" declares ${KIT_KEY}.root "${root}", which is not an ` +
        `absolute path of plain segments (e.g. "${suggestRoot(name)}")`
    );
    return;
  }
  // `/npm` is the compile-time spelling's own space. A kit rooted there
  // would make `/npm/@scope/name/x` ambiguous between "a package called
  // @scope/name" and "a file inside that kit", which is not a question worth
  // inventing a rule for
  if (root === '/npm' || root.startsWith('/npm/')) {
    errors.push(
      `kit "${name}" declares ${KIT_KEY}.root "${root}", but "/npm" is ` +
        `reserved for the <:import> spelling`
    );
    return;
  }
  const version = json.version;
  return { root, version: typeof version === 'string' ? version : undefined };
}

/**
 * The root a package would most likely want, for use in an error message
 * ONLY.
 *
 * Suggested rather than applied, which is the whole point: the ergonomics of
 * deriving a name are worth having, and the coupling is not. An author pastes
 * this and owns the result thereafter.
 */
export function suggestRoot(packageName: string): string {
  const unscoped = packageName.startsWith('@')
    ? packageName.substring(packageName.indexOf('/') + 1)
    : packageName;
  return '/' + unscoped;
}

/**
 * The directory of package `name` as resolved from `fromDir`, by walking up
 * through `node_modules` as Node itself would.
 *
 * Walked by hand rather than asked of `require.resolve`, which resolves
 * MODULES: a package with a restrictive `exports` map refuses
 * `<name>/package.json`, and a kit need not have a JavaScript entry point at
 * all for `<name>` on its own to resolve.
 *
 * `fromDir` is the importing file's package, not the application's, which is
 * what makes a kit importing another kit find the copy npm installed for IT
 * -- the distinction that nested installs and pnpm's layout turn from
 * pedantry into the difference between the right file and none.
 *
 * `.markout/kits` is searched at each rung as well, in the order `kitDirs`
 * uses, so that `/npm/<name>` finds a kit that arrived without npm by the
 * same walk as one that did not.
 */
export function findPackage(name: string, fromDir: string): string | undefined {
  let current = path.resolve(fromDir);
  for (;;) {
    for (const { dir } of kitDirs(current)) {
      const candidate = path.join(dir, ...name.split('/'));
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}
