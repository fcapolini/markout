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
const SKIP = new Set(['node_modules', '.git', 'coverage', 'dist']);
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const HEADING = /^#{1,6}\s+(.*)$/gm;

/** GitHub's heading slug: lowercased, punctuation dropped, spaces hyphenated */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function anchorsOf(file: string): Set<string> {
  const text = fs.readFileSync(file, 'utf8');
  return new Set([...text.matchAll(HEADING)].map(m => slug(m[1])));
}

function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
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
        if (!target) continue;
        const resolved = path.resolve(path.dirname(file), target);
        if (!fs.existsSync(resolved)) {
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
