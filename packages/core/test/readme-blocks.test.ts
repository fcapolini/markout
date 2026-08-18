import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../src/compiler';
import { renderPage } from '../src/render/render';

/**
 * Compiles every example in README.md, read out of the file itself.
 *
 * readme-examples.test.ts covers the first three deeply -- served over HTTP,
 * hydrated in a browser -- which is worth doing but doesn't scale to every
 * snippet. This covers all of them shallowly, and because the source is the
 * README rather than a copy of it, an example can't quietly stop working:
 * `:for-data` was documented here as a feature for some time while compiling
 * it threw.
 *
 * A block is a page if it starts with `<html`, and a fragment if it opens
 * with an `<!-- name.htm -->` comment naming the file it stands for -- which
 * is how the README already writes them, so imports resolve for free.
 * Anything else is an illustrative snippet and is skipped.
 */

interface Block {
  section: string;
  code: string;
}

function readmeBlocks(): Block[] {
  const md = fs.readFileSync(path.resolve(__dirname, '../../../README.md'), 'utf8');
  const blocks: Block[] = [];
  let section = '(preamble)';
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const heading = /^##\s+(.*)$/.exec(lines[i]);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (lines[i].trim() !== '```html') continue;
    const start = ++i;
    while (i < lines.length && lines[i].trim() !== '```') i++;
    blocks.push({ section, code: lines.slice(start, i).join('\n') });
  }
  return blocks;
}

const FRAGMENT = /^\s*<!--\s*([\w.-]+\.htm)\s*-->/;

describe('README examples', () => {
  let docroot: string;
  const blocks = readmeBlocks();

  beforeAll(() => {
    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-readme-'));
    // fragments first: a page block may import one declared above it
    for (const { code } of blocks) {
      const named = FRAGMENT.exec(code);
      named && fs.writeFileSync(path.join(docroot, named[1]), code);
    }
  });

  afterAll(() => {
    fs.existsSync(docroot) && fs.rmSync(docroot, { recursive: true });
  });

  it('finds the examples', () => {
    // a guard on the extractor itself: silently matching nothing would make
    // every assertion below vacuous
    expect(blocks.length).toBeGreaterThan(4);
    expect(blocks.some(b => b.code.startsWith('<html'))).toBe(true);
  });

  const pages = blocks.filter(b => b.code.startsWith('<html'));

  for (const [i, block] of pages.entries()) {
    // the README marks anything it describes but hasn't built; those are
    // expected to fail, and saying so here keeps the claim honest in both
    // directions -- it must fail while it says it does, and this test must
    // be updated when it stops
    const planned = /not yet implemented/i.test(block.section);

    it(`${planned ? 'rejects' : 'compiles'}: ${block.section}`, async () => {
      const file = `readme-${i}.html`;
      fs.writeFileSync(path.join(docroot, file), block.code);
      const page = await new Compiler({ docroot }).compile(`/${file}`);
      const messages = page.errors.map(e => e.msg);

      if (planned) {
        expect(messages.length).toBeGreaterThan(0);
        return;
      }
      expect(messages).toStrictEqual([]);
      expect(await renderPage(page)).toStrictEqual([]);
    });
  }
});

describe('README code quoted from the demo', () => {
  it('matches what the demo actually contains', () => {
    // the Componentization section quotes the bootstrap demo rather
    // than standing alone, so it can drift from the file it describes
    const md = fs.readFileSync(path.resolve(__dirname, '../../../README.md'), 'utf8');
    const demo = fs.readFileSync(
      path.resolve(__dirname, '../../../sites/site/demos/bootstrap/index.html'),
      'utf8'
    );
    // the whole call, not one attribute of it: pinning `:title="..."` meant
    // the check only ever noticed drift in that one spot, and went red
    // rather than informative when the demo dropped the attribute for a
    // slot.
    //
    // The tag name is captured and its own closing tag required. Spelling
    // that end literally is what broke this: `</bs-nav>` never matches
    // `</bs-navbar>`, so the non-greedy scan ran past the whole section to
    // the next `/>` anywhere in the file and compared four thousand
    // characters of prose against the demo. A test that can only fail is
    // worth no more than one that can only pass
    const quoted = /<(bs-[\w-]+)[\s\S]*?(?:\/>|<\/\1>)/.exec(md);
    expect(quoted).not.toBeNull();
    // the section quotes one tag; anything longer means the match ran on
    expect(quoted![0].length).toBeLessThan(400);
    expect(demo).toContain(quoted![0]);
    expect(demo).toContain(
      '<:import src="/npm/@markout-dev/bootstrap-kit/all.htm" />'
    );
  });
});
