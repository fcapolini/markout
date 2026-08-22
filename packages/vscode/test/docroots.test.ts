import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docrootFor, docrootsOf, manifestDocroots } from '../src/diagnostics';
import { diagnoseWorkspace } from '../src/workspace';

/**
 * Which docroot a file is read against, when a project has more than one.
 *
 * A docroot is what an absolute path resolves against, so this is not a
 * convenience: choose the wrong one and `<:import src="/lib.htm" />` reports
 * a missing file that is sitting right there. The window-scoped setting
 * could only ever name ONE, which was wrong for every project in a
 * multi-root window but the first -- so the value became plural, and the
 * project got a place to say it that is checked in rather than per-person.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-docroots-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(rel: string, text: string) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

function manifest(rel: string, docroot: unknown) {
  write(rel, JSON.stringify({ name: 'x', markout: { docroot } }));
}

describe('what `markout.docroot` may be', () => {
  it('takes one, as it always did', () => {
    expect(docrootsOf('site', dir)).toStrictEqual([path.join(dir, 'site')]);
  });

  it('takes several', () => {
    expect(docrootsOf(['a', 'b'], dir)).toStrictEqual([
      path.join(dir, 'a'),
      path.join(dir, 'b'),
    ]);
  });

  it('leaves an absolute entry alone, whatever base it is given', () => {
    expect(docrootsOf([path.join(dir, 'a')], '/somewhere/else')).toStrictEqual([
      path.join(dir, 'a'),
    ]);
  });

  it('drops what is not a docroot rather than refusing the lot', () => {
    // a half-typed setting is a normal state for a file being edited in, and
    // the guess underneath it is a working answer
    expect(docrootsOf(['a', '', '   ', 42, null, 'a'], dir)).toStrictEqual([
      path.join(dir, 'a'),
    ]);
    expect(docrootsOf(undefined, dir)).toStrictEqual([]);
    expect(docrootsOf({ docroot: 'a' }, dir)).toStrictEqual([]);
  });
});

describe('a project says it in its package.json', () => {
  it('reads one, relative to the manifest that declared it', () => {
    manifest('package.json', 'site');
    write('site/index.html', '<html></html>');
    expect(manifestDocroots(path.join(dir, 'site/index.html'), dir)).toStrictEqual([
      path.join(dir, 'site'),
    ]);
  });

  it('reads several', () => {
    manifest('package.json', ['sites/one', 'sites/two']);
    expect(manifestDocroots(path.join(dir, 'sites/one/a.html'), dir)).toStrictEqual([
      path.join(dir, 'sites/one'),
      path.join(dir, 'sites/two'),
    ]);
  });

  it('walks past a manifest that says nothing about markout', () => {
    // a package in between is not an answer -- nearest that SAYS SO wins,
    // which is the rule guessDocroot already uses
    manifest('package.json', ['sites/one']);
    write('sites/one/package.json', JSON.stringify({ name: 'inner' }));
    expect(manifestDocroots(path.join(dir, 'sites/one/a.html'), dir)).toStrictEqual([
      path.join(dir, 'sites/one'),
    ]);
  });

  it('stops at the workspace folder: above it is somebody else\'s project', () => {
    manifest('package.json', 'site');
    const folder = path.join(dir, 'nested');
    fs.mkdirSync(folder, { recursive: true });
    expect(manifestDocroots(path.join(folder, 'a.html'), folder)).toStrictEqual([]);
  });

  it('says nothing for a manifest that does not parse', () => {
    write('package.json', '{ not json');
    expect(manifestDocroots(path.join(dir, 'a.html'), dir)).toStrictEqual([]);
  });
});

describe('choosing one for a file', () => {
  it('takes the setting over the project and the guess', () => {
    manifest('package.json', 'wrong');
    write('right/a.html', '<html></html>');
    expect(
      docrootFor(path.join(dir, 'right/a.html'), {
        docroot: path.join(dir, 'right'),
        workspaceFolders: [dir],
      })
    ).toBe(path.join(dir, 'right'));
  });

  it('picks the innermost configured docroot that contains the file', () => {
    // docroots nest as freely as workspace folders do, and the same rule
    // decides between them
    const chosen = docrootFor(path.join(dir, 'outer/inner/a.html'), {
      docroot: [path.join(dir, 'outer'), path.join(dir, 'outer/inner')],
      workspaceFolders: [dir],
    });
    expect(chosen).toBe(path.join(dir, 'outer/inner'));
  });

  it('resolves a relative setting against each workspace folder', () => {
    write('site/a.html', '<html></html>');
    expect(
      docrootFor(path.join(dir, 'site/a.html'), { docroot: 'site', workspaceFolders: [dir] })
    ).toBe(path.join(dir, 'site'));
  });

  it('falls through to the project when the setting does not contain the file', () => {
    // the whole complaint: one value applied to every file was wrong for
    // every project in the window but the one it named
    manifest('package.json', ['one', 'two']);
    write('two/a.html', '<html></html>');
    expect(
      docrootFor(path.join(dir, 'two/a.html'), {
        docroot: path.join(dir, 'elsewhere'),
        workspaceFolders: [dir],
      })
    ).toBe(path.join(dir, 'two'));
  });

  it('falls through to the guess when nothing is configured', () => {
    write('markout/a.html', '<html></html>');
    expect(docrootFor(path.join(dir, 'markout/a.html'), { workspaceFolders: [dir] })).toBe(
      path.join(dir, 'markout')
    );
  });

  it('still applies a single docroot to the file under it, as before', () => {
    write('site/a.html', '<html></html>');
    expect(
      docrootFor(path.join(dir, 'site/a.html'), {
        docroot: path.join(dir, 'site'),
        workspaceFolders: [dir],
      })
    ).toBe(path.join(dir, 'site'));
  });
});

describe('and the sweep reads each page against its own', () => {
  it('resolves `/lib.htm` per docroot, in one folder holding two', async () => {
    write(
      'package.json',
      JSON.stringify({
        name: 'monorepo',
        dependencies: { markout: '^0.2.0' },
        markout: { docroot: ['sites/one', 'sites/two'] },
      })
    );
    // the same absolute path in both pages, naming a DIFFERENT file in each
    write('sites/one/lib.htm', '<lib><:define tag="x-a:div">${nopeOne}</:define></lib>');
    write(
      'sites/one/index.html',
      '<html><head><:import src="/lib.htm" /></head><body><x-a /></body></html>'
    );
    write('sites/two/lib.htm', '<lib><:define tag="x-b:div">${nopeTwo}</:define></lib>');
    write(
      'sites/two/index.html',
      '<html><head><:import src="/lib.htm" /></head><body><x-b /></body></html>'
    );

    const { problems } = await diagnoseWorkspace({ workspaceFolders: [dir] });
    const said = problems
      .flatMap(p =>
        p.diagnostics.map(d => `${path.relative(dir, p.filePath).split(path.sep).join('/')}: ${d.message}`)
      )
      .sort();
    // each page found its own lib.htm -- and neither reported the missing
    // file that a single docroot would have made of the other's
    expect(said).toStrictEqual([
      'sites/one/lib.htm: Unknown reference: "nopeOne"',
      'sites/two/lib.htm: Unknown reference: "nopeTwo"',
    ]);
  });
});
