import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Every relative link in every Markdown file points at something that exists.
 *
 * Renaming a page is exactly what breaks these, and a dead link is invisible
 * until a reader follows it. Cheap to check, so it isn't left to noticing.
 */

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'coverage', 'dist', 'out']);

/**
 * Nothing hidden, which is not tidiness: the CLI's own suite builds into
 * `packages/cli/.cli-build-out-XXXX/` and deletes it when it is done, and a
 * kit materialized there brings its README with it. This walk listing a file
 * that a test removes a moment later is a failure about nothing, in a suite
 * about links. No dot-directory in this repository holds documentation.
 */
function hidden(name: string): boolean {
  return name.startsWith('.');
}
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const HEADING = /^#{1,6}\s+(.*)$/gm;

/** GitHub's heading slug: lowercased, punctuation dropped, spaces hyphenated */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    // one hyphen per space, not one per run of them. GitHub drops the
    // punctuation first, so `Optional rendering — designed` is left holding
    // two spaces and slugs to `...rendering--designed`. Collapsing here
    // would have this file quietly disagree with the thing it links to,
    // passing a link that 404s and failing one that works
    .replace(/\s/g, '-');
}

function anchorsOf(file: string): Set<string> {
  const text = fs.readFileSync(file, 'utf8');
  return new Set([...text.matchAll(HEADING)].map(m => slug(m[1])));
}

function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || hidden(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

describe('documentation links', () => {
  const files = markdownFiles(ROOT);

  it('finds the documentation', () => {
    // the walk silently returning nothing would make the rest vacuous
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`resolve in ${path.relative(ROOT, file)}`, () => {
      const text = fs.readFileSync(file, 'utf8');
      const dead: string[] = [];
      for (const match of text.matchAll(LINK)) {
        if (/^(https?:|mailto:)/.test(match[1])) continue;
        const [target, fragment] = match[1].split('#');
        // no target means the link points into THIS file. Skipping those left
        // the commonest kind of link in a long page -- a contents entry --
        // as the one kind nothing checked
        const resolved = target ? path.resolve(path.dirname(file), target) : file;
        if (target && !fs.existsSync(resolved)) {
          dead.push(target);
          continue;
        }
        // a heading that got renamed leaves the link resolving to the right
        // file and the wrong place in it, which is quieter still
        if (fragment && resolved.endsWith('.md') && !anchorsOf(resolved).has(fragment)) {
          dead.push(`${target}#${fragment}`);
        }
      }
      expect(dead).toStrictEqual([]);
    });
  }
});
