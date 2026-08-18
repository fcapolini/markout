import fs from 'fs';
import path from 'path';

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
 * part need not be, so `@markout-dev/bootstrap-kit` and `@acme/bootstrap-kit`
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
  /** package name, e.g. `@markout-dev/bootstrap-kit` */
  name: string;
  /** absolute path of the package directory */
  dir: string;
  /** declared logical root, e.g. `/bootstrap-kit` */
  root: string;
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
 */
export function discoverKits(docroot: string): Discovery {
  const root = path.resolve(docroot);
  const kits: Kit[] = [];
  const errors: string[] = [];
  const byRoot = new Map<string, Kit>();
  const seenDir = new Set<string>();

  const consider = (name: string, dir: string) => {
    if (seenDir.has(dir)) {
      return;
    }
    seenDir.add(dir);
    const declared = readKitRoot(name, dir, errors);
    if (!declared) {
      return;
    }
    const clash = byRoot.get(declared);
    if (clash) {
      // covers two DIFFERENT kits claiming one root and two versions of one
      // kit claiming theirs, which npm's nested installs make a legal tree;
      // a site cannot serve two versions of a kit's assets at one URL either
      // way, so there is nothing to pick between
      errors.push(
        `kit "${name}" claims root "${declared}", already claimed by ` +
          `"${clash.name}" -- one of them must declare a different ` +
          `${KIT_KEY}.root`
      );
      return;
    }
    const shadowed = path.join(root, declared);
    if (fs.existsSync(shadowed)) {
      errors.push(
        `kit "${name}" claims root "${declared}", but the docroot already ` +
          `has "${shadowed}" -- preferring either one would silently hide ` +
          `the other`
      );
      return;
    }
    const kit: Kit = { name, dir, root: declared };
    byRoot.set(declared, kit);
    kits.push(kit);
    // a kit's own dependencies may be kits: the Bootstrap kit importing the
    // std kit is the case, and under a nested install its copy lives here
    // rather than beside the application's
    scan(path.join(dir, 'node_modules'), consider);
  };

  for (const dir of nodeModulesDirs(root)) {
    scan(dir, consider);
  }
  return { kits, errors };
}

/**
 * `node_modules` directories from `dir` upwards, nearest first.
 *
 * Upwards from the DOCROOT, which is the project the pages belong to -- and
 * not from the working directory, which is wherever the operator happened to
 * be standing.
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

/** every package directly in a `node_modules`, scoped ones included */
function scan(nodeModules: string, visit: (name: string, dir: string) => void) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // `.bin`, `.package-lock.json` and friends are npm's, not a package's
    if (entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(nodeModules, entry.name);
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
function readKitRoot(name: string, dir: string, errors: string[]): string | undefined {
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
  return root;
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
 */
export function findPackage(name: string, fromDir: string): string | undefined {
  let current = path.resolve(fromDir);
  for (;;) {
    const candidate = path.join(current, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}
