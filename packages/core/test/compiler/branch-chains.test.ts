import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';

/**
 * A branch chain whose branches are custom tags. Issue #25.
 *
 * A chain links both ways -- a follower has to find the branch it continues
 * and the head has to find its first follower -- and a custom tag is not
 * compiled as the scope the loader built for it: expandCustomTagUsages puts
 * an instance in its place, with an id of its own, and detaches that one.
 * The backward link was mapped onto the instance and the forward link was
 * not, so a chain whose next branch was a custom tag pointed at the id of a
 * scope that reaches no output. The runtime found no such sibling and
 * showed no branch at all -- not the custom one, not any of them.
 */
let docroot: string;
let seq = 0;

const DEFS =
  '<html><head><:define tag="c-a:div">A</:define>' +
  '<:define tag="c-b:div">B</:define></head><body>';

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-branches-'));
});
afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

/** what the body renders, markers and bookkeeping taken out */
async function shown(branches: string) {
  const name = `c${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), `${DEFS}${branches}</body></html>`);
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  expect(await renderPage(page)).toStrictEqual([]);
  const html = page.source.doc.toString();
  return html
    .slice(html.indexOf('<body'), html.indexOf('<script>window.'))
    .replace(/<!--.*?-->/g, '')
    .replace(/ data-markout="[^"]*"| class=""/g, '')
    .replace(/<\/?body>/g, '');
}

describe('a branch chain', () => {
  // every row of the table the issue was filed with, and the one it did not
  // list: a chain of two custom tags whose head is the one taken
  it.each([
    ['plain throughout', '<p :if=${false}>P1</p><p :else>P2</p>', '<p>P2</p>'],
    ['custom head, taken', '<c-a :if=${true}/><p :else>P2</p>', '<div>A</div>'],
    [
      'custom head, plain branch taken',
      '<c-a :if=${false}/><p :else-if=${true}>P2</p><p :else>P3</p>',
      '<p>P2</p>',
    ],
    ['custom taken through :else', '<c-a :if=${false}/><c-b :else/>', '<div>B</div>'],
    ['custom :else after a plain head', '<p :if=${false}>P1</p><c-a :else/>', '<div>A</div>'],
    [
      'custom taken through :else-if',
      '<p :if=${false}>P1</p><c-a :else-if=${true}/><c-b :else/>',
      '<div>A</div>',
    ],
    ['custom throughout, head taken', '<c-a :if=${true}/><c-b :else/>', '<div>A</div>'],
  ])('shows the branch that holds: %s', async (_what, branches, expected) => {
    expect(await shown(branches)).toBe(expected);
  });

  it('shows one branch and no more, whichever it is', async () => {
    const out = await shown(
      '<c-a :if=${false}/><c-b :else-if=${true}/><p :else>P</p>'
    );
    expect(out).toBe('<div>B</div>');
  });
});
