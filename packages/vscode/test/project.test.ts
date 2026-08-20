import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Compiler } from '@markout-lang/core';
import { isMarkoutProject, looksLikeMarkout } from '../src/diagnostics';
import { formatEdits } from '../src/formatting';

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
    write('package.json', JSON.stringify({ name: 'site', dependencies: { markout: '^0.2.0' } }));
    expect(isMarkoutProject(dir)).toBe(true);
  });

  it('says yes to one that depends on a scoped package of ours', () => {
    write(
      'package.json',
      JSON.stringify({ name: 'site', devDependencies: { '@markout-lang/express': '^0.2.0' } })
    );
    expect(isMarkoutProject(dir)).toBe(true);
  });

  it('says yes to one of our own workspaces, which depends on nothing', () => {
    // a kit is a package.json and a directory of fragments; it has no
    // dependencies at all, and its own pages are the ones most worth checking
    write('package.json', JSON.stringify({ name: '@markout-lang/bootstrap-kit' }));
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

describe('a page that speaks for itself', () => {
  /**
   * The case a project gate alone would have failed: markout's delivery
   * story is that you install nothing -- write the pages, `npx markout
   * ./site`, done. There is no package.json to depend on markout, so the
   * page has to be the evidence.
   */
  it('recognises a directive tag', () => {
    expect(looksLikeMarkout('<html><head><:import src="/lib.htm" /></head></html>')).toBe(true);
    expect(looksLikeMarkout('<lib><:define tag="x-a:div">a</:define></lib>')).toBe(true);
  });

  it('recognises an attribute whose value is an expression', () => {
    expect(looksLikeMarkout('<html :count=${0}><body>${count}</body></html>')).toBe(true);
    expect(looksLikeMarkout('<head ::bsRadius=${"1rem"}></head>')).toBe(true);
  });

  it('is not fooled by the neighbours, which is the whole difficulty', () => {
    // Alpine and Vue both write colon attributes; theirs are quoted strings,
    // and it is the `=${` that no one else writes
    expect(looksLikeMarkout(`<div x-data="{o:false}"><b :class="o ? 'a' : 'b'">x</b></div>`)).toBe(
      false
    );
    expect(looksLikeMarkout('<my-c :prop="x" v-if="y">{{ msg }}</my-c>')).toBe(false);
    // Thymeleaf's attributes do not START with a colon, and its expressions
    // are quoted
    expect(
      looksLikeMarkout('<html xmlns:th="http://x"><p th:text="${user.name}">x</p></html>')
    ).toBe(false);
  });

  it('does NOT treat ${…} on its own as evidence', () => {
    // markout's one interpolation syntax, and also JSP EL's and
    // Underscore's. A page holding nothing else cannot be told from theirs,
    // and guessing wrong here is an error on every line of someone's project
    expect(looksLikeMarkout('<html><body>Hello ${user.name}</body></html>')).toBe(false);
  });

  it('says nothing about plain HTML, which has nothing to report anyway', () => {
    expect(looksLikeMarkout('<html><body><h1>Hi</h1><p>Costs $5</p></body></html>')).toBe(false);
  });
});

describe('before any gate, the extension has to be running at all', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
  );

  it('starts on a workspace that holds a markout docroot', () => {
    // Reported as "at launch it's still empty, but as soon as I open any
    // source file it populates with the problems of the whole project" --
    // which was not the server at all. `onLanguage:html` alone starts the
    // extension when an HTML document is OPENED, and a Problems panel that
    // waits to be shown a file is the very thing the workspace sweep exists
    // to stop being.
    expect(manifest.activationEvents).toContain('workspaceContains:**/markout/**/*.html');
  });

  it('names a convention that is really the convention', () => {
    // the glob above is a claim about where markout pages live, and the
    // fixture is a project laid out the way the CLI's default expects
    const fixture = path.resolve(__dirname, '../fixture/markout/index.html');
    expect(fs.existsSync(fixture)).toBe(true);
  });

  it('still starts when HTML is opened, for a docroot named anything else', () => {
    // the convention is the only thing VS Code can check cheaply before
    // running anything -- a project that depends on markout but calls its
    // docroot something else cannot be recognised without opening a file,
    // and this extension does not get to run everywhere on the chance
    expect(manifest.activationEvents).toContain('onLanguage:html');
  });
});

describe('this repository', () => {
  it('is recognised by its own gate', () => {
    // the site is where the pages are, and it is the case that has to work
    const site = path.resolve(__dirname, '../../../sites/site');
    expect(isMarkoutProject(site)).toBe(true);
  });

  it('recognises its own pages by their text alone', () => {
    // every real page and fragment, against the syntax gate rather than the
    // project one -- because this is what a package.json-less project gets
    const roots = ['sites/site', 'kits'].map(r => path.resolve(__dirname, '../../..', r));
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.html?$/.test(entry.name)) pages.push(full);
      }
    };
    roots.forEach(walk);
    expect(pages.length).toBeGreaterThan(30);

    const missed = pages
      .filter(f => !looksLikeMarkout(fs.readFileSync(f, 'utf8')))
      .map(f => path.basename(f));
    // the only ones that should miss are the pages that hold no markout at
    // all: the hand-written twin the bootstrap demo is compared against, and
    // the `<lib>` wrappers that carry only meta tags
    expect(missed.sort()).toStrictEqual([
      'base.htm',
      'base.htm',
      'base.htm',
      'index-plain.html',
    ]);
  });

  it('is already formatted the way the formatter would format it', () => {
    // the strongest thing that can be said about a formatter: run it over
    // every file in the repository -- the kit, the demo site, both
    // conventions -- and it asks for nothing. These files were laid out by
    // hand and by a separate one-off script; this is a second implementation
    // agreeing with them line for line, which neither could do by copying
    // the other.
    //
    // It also means a contributor's Format Document is a no-op on a file
    // nobody has touched, which is the only way a formatter earns being left
    // on.
    const roots = ['sites/site', 'kits'].map(r => path.resolve(__dirname, '../../..', r));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.html?$/.test(entry.name)) files.push(full);
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(30);

    const asked = files
      .map(file => ({
        file,
        edits: formatEdits({ text: fs.readFileSync(file, 'utf8'), pathname: file }),
      }))
      .filter(({ edits }) => edits.length)
      .map(({ file, edits }) => `${path.basename(file)}:${edits[0].range.start.line + 1}`);
    expect(asked).toStrictEqual([]);
  });
});
