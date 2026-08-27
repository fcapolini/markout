import fs from 'fs';
import path from 'path';

/**
 * `.markout/` -- what a project records about itself, and where a kit it
 * asked for goes.
 *
 * READING it, which is the half the compiler needs: `discoverKits` reports a
 * kit the project asked for and has not got, and cannot do that without
 * knowing what was asked for. Creating and updating the directory is the
 * installer's, in `@markout-lang/cli/kits` -- core describes a project and
 * does not change one. See docs/design/without-node.md.
 *
 * The layout constants live HERE, with the file that reads and writes the
 * directory, rather than with discovery that walks it: discovery has to know
 * about the manifest to report a kit the project asked for and has not got,
 * and two modules that import each other evaluate their constants in
 * whichever order a bundler picked. One direction only, and this is the end
 * of it.
 *
 * ## `.markout/kits.json` -- the kits a project asked for, as against the
 * kits it has.
 *
 * Discovery on its own can only report what is installed, so a kit that is
 * missing is not a fact it has access to: the page using that kit's tags
 * compiles, renders them as unknown elements, and says nothing. For somebody
 * who has never installed a package that is the worst available outcome --
 * a blank region of a page and no message naming a cause.
 *
 * The manifest is what makes the absence nameable. It is read by the
 * COMPILER rather than by the editor, so `markout build`, the dev server and
 * the editor all say the same sentence, and CI cannot build a tree the editor
 * called complete. See docs/design/without-node.md.
 */

/** the project's own directory */
export const MARKOUT_DIR = '.markout';

/**
 * Where a kit that needed no npm goes.
 *
 * Laid out as a `node_modules` is -- a directory per package, a scope as a
 * directory of them -- so discovery reaches it as one more rung on the walk
 * it already does and nothing downstream can tell how a kit arrived. That the
 * RESOLUTION stays in the compiler is the whole point: the editor only
 * fetches files, so the editor, a preview, a build, a teammate's terminal and
 * CI read the same tree and agree by construction.
 */
export const KITS_DIR = `${MARKOUT_DIR}/kits`;

/** the manifest, relative to the directory holding `.markout` */
export const MANIFEST_FILE = `${MARKOUT_DIR}/kits.json`;

/**
 * What the project asked for: a package name to an EXACT version.
 *
 * Exact, and a range is refused rather than resolved -- see
 * docs/design/without-node.md. Two clones of one repository that build
 * different things is the failure this audience is least equipped to
 * diagnose, and a version moves only when somebody accepts a bump.
 *
 * `kits` is a key rather than the file's whole content so that the next
 * thing a project wants to record does not need the format to change shape.
 * That promise is only kept if a read-modify-write preserves what it did not
 * understand, so `readManifest` carries every other top-level key through --
 * see the index signature, and the round-trip test in the CLI's suite. A
 * reader that dropped them would make an OLD tool silently delete a NEW
 * tool's settings, which is the worst way for a format to grow.
 */
export interface Manifest {
  kits: Record<string, string>;
  /** whatever else the file held, untouched and written back as it was */
  [key: string]: unknown;
}

export interface ManifestFile {
  /** the directory holding `.markout`, i.e. what `kits.json` is relative to */
  dir: string;
  /** absolute path of the file itself, for a message that has to name it */
  file: string;
  /** what it asked for; empty when the file was unreadable, with `errors` set */
  manifest: Manifest;
  /** refusals, each already a complete sentence */
  errors: string[];
}

/** a version this file accepts: exact, and nothing else */
const EXACT_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * The nearest `.markout/kits.json` at or above `docroot`, if there is one.
 *
 * The same walk discovery does, for the same reason: a docroot nested inside
 * a project belongs to that project, and the manifest is a project fact. A
 * project with no manifest is not an error -- it is every project that
 * installed its kits with npm, which is most of them.
 */
export function findManifest(docroot: string): ManifestFile | undefined {
  let current = path.resolve(docroot);
  for (;;) {
    const file = path.join(current, ...MANIFEST_FILE.split('/'));
    if (fs.existsSync(file)) {
      return readManifest(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

/**
 * Read the manifest in `dir`, reporting everything wrong with it.
 *
 * Every refusal here is a refusal to GUESS. A file that cannot be parsed, a
 * version that is a range, a name that is not a package name: each one has an
 * obvious-looking repair, and applying it silently would make the file mean
 * something other than what it says -- which is the one property a manifest
 * cannot afford to lose.
 */
export function readManifest(dir: string): ManifestFile {
  const file = path.join(dir, ...MANIFEST_FILE.split('/'));
  const empty: ManifestFile = { dir, file, manifest: { kits: {} }, errors: [] };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return empty;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ...empty, errors: [`"${file}" is not valid JSON -- ${(e as Error).message}`] };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ...empty, errors: [`"${file}" should hold an object`] };
  }
  // everything the file held, so that a key this version has never heard of
  // survives being read, modified and written back
  const rest = { ...(json as Record<string, unknown>) };
  delete rest.kits;
  const declared = (json as { kits?: unknown }).kits;
  if (declared === undefined) {
    return { ...empty, manifest: { ...rest, kits: {} } };
  }
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    return {
      ...empty,
      manifest: { ...rest, kits: {} },
      errors: [`"${file}": "kits" should be an object of package name to version`],
    };
  }
  const errors: string[] = [];
  const kits: Record<string, string> = {};
  for (const [name, version] of Object.entries(declared as Record<string, unknown>)) {
    if (typeof version !== 'string') {
      errors.push(`"${file}": the version of "${name}" should be a string`);
      continue;
    }
    if (!EXACT_RE.test(version)) {
      // named as the rule rather than as a parse failure: `^0.4.0` is a
      // perfectly good npm range and a person who wrote one was not making a
      // typo, they were expecting a resolver this file deliberately has not
      // got
      errors.push(
        `"${file}": "${name}" is pinned to "${version}", which is not an ` +
          `exact version -- kits.json pins (e.g. "0.4.0"), so that every ` +
          `clone builds the same tree; use "markout add ${name}" to move it`
      );
      continue;
    }
    kits[name] = version;
  }
  return { dir, file, manifest: { ...rest, kits }, errors };
}
