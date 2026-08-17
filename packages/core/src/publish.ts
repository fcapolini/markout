import fs from 'fs';
import path from 'path';
import { NodeType } from './html/dom';
import { parse } from './html/parser';
import { IMPORT_DIRECTIVE_TAG, INCLUDE_SRC_ATTR } from './html/preprocessor';
import type * as dom from './html/server-dom';
import type { Resolver } from './paths';

/**
 * What may be published out of a directory, and what a walk of one finds.
 *
 * One set of rules with two consumers -- `build`, which writes files, and the
 * middleware, which answers requests -- because a kit that is servable in dev
 * and missing from the deliverable is the failure the whole kit design is
 * arranged to avoid. See docs/design/npm-kits.md.
 *
 * The rules apply to a kit exactly as they apply to the docroot, which is
 * what makes "the kit behaves as though it were symlinked into the docroot"
 * true rather than approximately true. A kit publishes its WHOLE directory
 * minus these three exclusions; there is deliberately no key by which it
 * declares a subset. A published package's tarball is public already --
 * anyone can fetch it from the registry -- so serving its `package.json`
 * discloses nothing, and a kit that published less than a vendored copy of
 * itself would make vendoring a change in behaviour.
 */

/**
 * The dot-prefixed names a build copies, out of the many it skips.
 *
 * An ALLOW-list rather than a rule reversed, because the two kinds of dotfile
 * are different in kind rather than in degree. What belongs in a deployable is
 * a closed, standardised set: `.well-known` is specified (RFC 8615) for exactly
 * this -- ACME challenges, `security.txt`, `assetlinks.json` -- and the other
 * two are a host's marker and a host's config. What must never be published is
 * open-ended and gets a new member with every tool anyone installs: `.env`,
 * `.git`, `.DS_Store`, `.gitignore`, `.vscode`.
 *
 * Default-deny with three exceptions gets both right, and keeps the worst
 * outcome available -- a `.env` copied into a public bucket -- impossible. A
 * deny-list over the other set would be guesswork, which is the same reason
 * this build does not try to guess which extensions are "source".
 *
 * Matched by name at any depth, since `.htaccess` is meaningful per directory.
 */
export const SERVABLE_DOTFILES = new Set([
  '.well-known', // RFC 8615: the standard place for things that must be public
  '.nojekyll', // GitHub Pages: publish this directory as-is
  '.htaccess', // Apache per-directory config for the deployed tree
]);

/**
 * The attribute by which a page lets an imported kit contribute PAGES to the
 * site, and not merely fragments and resources.
 *
 *     <:import src="/npm/@markout/showy-kit/all.htm" allow-pages />
 *
 * Default-deny, and named for what it is. A kit's `.html` files would
 * otherwise be pages of the importing site -- which is what a symlinked
 * directory of the same name gives, and the one place this design departs
 * from that equivalence. It departs because the failure is real and was
 * measured: a kit shipping a broken showcase page turns the consumer's build
 * red over a file they did not write and cannot edit.
 *
 * `allow-` rather than `with-` because this is a permission rather than a
 * packaging option, in the same sense as an iframe's
 * `sandbox="allow-scripts"`: the host is granting embedded third-party
 * content a capability it does not otherwise have. What is granted is space
 * in the site's own URL namespace, which is the thing every refusal in
 * docs/design/npm-kits.md exists to protect.
 *
 * Counted ONLY from a docroot page's own `<head>`, never from inside a kit's
 * fragment. A kit could otherwise opt itself in, which is the squatting the
 * rest of the design refuses -- so the restriction is the point rather than
 * a limitation of the scan.
 */
export const ALLOW_PAGES_ATTR = 'allow-pages';

/**
 * The kits whose pages the docroot has allowed, by logical root.
 *
 * Derived by scanning the WHOLE docroot rather than accumulating as pages
 * happen to be compiled: the server must answer `/showy-kit/index.html` the
 * same way whether or not anything has been visited yet, and a set that grew
 * with traffic would make that answer depend on what somebody looked at
 * first. One function, used by both the middleware and `build`, for the same
 * reason the publishing rules above are shared -- the two must not disagree
 * about what the site contains.
 *
 * A shallow parse, not a compile: the attribute is only meaningful on a
 * page's own `<head>`, so nothing here needs the preprocessor to run.
 */
export async function allowedPageKits(
  docroot: string,
  resolver: Resolver
): Promise<Set<string>> {
  const allowed = new Set<string>();
  const { pages } = await walkTree(docroot);
  for (const pathname of pages) {
    let text: string;
    try {
      text = await fs.promises.readFile(path.join(docroot, pathname), 'utf8');
    } catch {
      continue;
    }
    const source = parse(text, pathname, undefined, true);
    const head = source.doc?.head;
    if (!head) {
      continue;
    }
    for (const node of head.childNodes) {
      if (node.nodeType !== NodeType.ELEMENT) {
        continue;
      }
      const e = node as dom.ServerElement;
      if (
        e.tagName !== IMPORT_DIRECTIVE_TAG ||
        !e.getAttributeNames().includes(ALLOW_PAGES_ATTR)
      ) {
        continue;
      }
      const src = e.getAttribute(INCLUDE_SRC_ATTR);
      const at = src && resolver.resolve(src, path.posix.dirname(pathname));
      at && at.ok && at.root.kit && allowed.add(at.root.prefix);
    }
  }
  return allowed;
}

/**
 * Whether one path segment may be published.
 *
 * `node_modules` is excluded so that a docroot of `.` in a project root does
 * not produce a deliverable measured in gigabytes -- and, for a kit, so that
 * its own dependencies are not republished under its root.
 */
export function publishableSegment(name: string): boolean {
  if (name === 'node_modules') {
    return false;
  }
  return !name.startsWith('.') || SERVABLE_DOTFILES.has(name);
}

/** whether every segment of a logical pathname may be published */
export function publishablePath(pathname: string): boolean {
  return pathname.split('/').every(s => !s || publishableSegment(s));
}

/**
 * Every page and every asset under `dir`, as pathnames relative to it with a
 * leading slash.
 *
 * `.html` is a page and `.htm` is a fragment, which is the distinction the
 * server already draws by refusing to serve the second -- so a fragment is
 * not copied either. Its content reaches the output inlined into the pages
 * that imported it, and shipping the source alongside would publish a file
 * the served mode answers 404 for.
 *
 * Symlinks are FOLLOWED, which is not a detail: `kits/bootstrap/std-kit` is a
 * link to the std kit next door, and a directory entry that is a link is
 * neither a file nor a directory to `readdir` -- so treating the dirent's word
 * as final copied a directory as though it were a file. Resolved paths are
 * remembered because following links is how a walk finds its way into a cycle.
 */
export async function walkTree(
  dir: string
): Promise<{ pages: string[]; assets: string[] }> {
  const pages: string[] = [];
  const assets: string[] = [];
  const seen = new Set<string>();
  const visit = async (at: string) => {
    const real = await fs.promises.realpath(at);
    if (seen.has(real)) {
      return;
    }
    seen.add(real);
    const entries = await fs.promises.readdir(at, { withFileTypes: true });
    for (const entry of entries) {
      if (!publishableSegment(entry.name)) {
        continue;
      }
      const full = path.join(at, entry.name);
      // stat rather than the dirent for a link, so that what it POINTS AT
      // decides -- and a broken one is skipped rather than fatal, since a
      // dangling link in a docroot is not this command's business
      const stats = entry.isSymbolicLink()
        ? await fs.promises.stat(full).catch(() => null)
        : entry;
      if (!stats) {
        continue;
      }
      if (stats.isDirectory()) {
        await visit(full);
        continue;
      }
      const pathname = '/' + path.relative(dir, full).split(path.sep).join('/');
      const ext = path.posix.extname(pathname).toLowerCase();
      if (ext === '.html') {
        pages.push(pathname);
      } else if (ext !== '.htm') {
        assets.push(pathname);
      }
    }
  };
  await visit(dir);
  return { pages: pages.sort(), assets: assets.sort() };
}
