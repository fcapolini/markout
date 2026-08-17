import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Compiler } from '@markout/core';
import { isMarkoutProject } from '../src/diagnostics';

/**
 * Whether this extension should say anything about a given HTML file.
 *
 * Markout claims no suffix of its own -- a page is a `.html` file like any
 * other -- so the extension cannot answer that by looking at the file, and
 * getting it wrong is the difference between a useful tool and one that puts
 * a red squiggle on every line of somebody's Thymeleaf project.
 *
 * Two halves, both checked here: that plain HTML really is quiet under the
 * compiler (which is why running on `.html` is thinkable at all), and that
 * the few constructs where it is NOT quiet are gated behind whether the
 * project uses markout.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-project-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(rel: string, text: string) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

async function errorsIn(html: string): Promise<string[]> {
  write('page.html', html);
  const page = await new Compiler({ docroot: dir }).compile('/page.html');
  return page.errors.map(e => e.msg);
}

describe('plain HTML, under the markout compiler', () => {
  it('is quiet: markout is a superset, so most pages simply compile', async () => {
    expect(
      await errorsIn(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
          '<title>Plain</title></head><body><h1 class="x">Hi</h1>' +
          '<p>Costs $5, or 50% off</p></body></html>'
      )
    ).toStrictEqual([]);
  });

  it('leaves script contents alone, template literals included', async () => {
    expect(
      await errorsIn('<html><body><script>const s = `hi ${name}, ${1 + 1}`;</script></body></html>')
    ).toStrictEqual([]);
  });

  it('means nothing by another engine\'s syntax', async () => {
    expect(await errorsIn('<html><body>{{ title }}{% if x %}a{% endif %}</body></html>')).toStrictEqual(
      []
    );
    expect(await errorsIn('<html><body><?php echo $name; ?></body></html>')).toStrictEqual([]);
  });

  it('DOES read ${…} outside a script, which is the whole problem', async () => {
    // this is not a bug: `${…}` is markout's one interpolation syntax, and a
    // file containing it is indistinguishable from a markout page. It is
    // also what JSP EL, Thymeleaf and Underscore put in .html files
    expect(await errorsIn('<html><body><p>Mail ${user}@example.com</p></body></html>')).toHaveLength(
      1
    );
    expect(await errorsIn('<html><head><style>.a { content: "${x}"; }</style></head></html>')).toHaveLength(
      1
    );
  });
});

describe('so the question is asked about the project', () => {
  it('says yes to a project that depends on markout', () => {
    write('package.json', JSON.stringify({ name: 'site', dependencies: { markout: '^0.4.0' } }));
    expect(isMarkoutProject(dir)).toBe(true);
  });

  it('says yes to one that depends on a scoped package of ours', () => {
    write(
      'package.json',
      JSON.stringify({ name: 'site', devDependencies: { '@markout/express': '^0.4.0' } })
    );
    expect(isMarkoutProject(dir)).toBe(true);
  });

  it('says yes to one of our own workspaces, which depends on nothing', () => {
    // a kit is a package.json and a directory of fragments; it has no
    // dependencies at all, and its own pages are the ones most worth checking
    write('package.json', JSON.stringify({ name: '@markout/bootstrap-kit' }));
    expect(isMarkoutProject(dir)).toBe(true);
  });

  it('says no to a project that has never heard of markout', () => {
    write('package.json', JSON.stringify({ name: 'app', dependencies: { express: '^5.0.0' } }));
    expect(isMarkoutProject(dir)).toBe(false);
  });

  it('says no where there is no package.json at all', () => {
    // a Java project's HTML, a folder of static pages, a gist
    expect(isMarkoutProject(dir)).toBe(false);
  });

  it('says no rather than guessing when the manifest is broken', () => {
    write('package.json', '{ this is not json');
    expect(isMarkoutProject(dir)).toBe(false);
  });
});

describe('this repository', () => {
  it('is recognised by its own gate', () => {
    // the site is where the pages are, and it is the case that has to work
    const site = path.resolve(__dirname, '../../../sites/site');
    expect(isMarkoutProject(site)).toBe(true);
  });
});
