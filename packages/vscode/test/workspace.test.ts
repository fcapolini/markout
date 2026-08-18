import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetPages } from '../src/pages';
import { diagnoseWorkspace } from '../src/workspace';

/**
 * Every problem in the project, not only in the files that are open.
 *
 * Which is what the Problems panel is for: somebody asking whether the
 * project is alright before committing it. Answering about open editors only
 * makes it a panel about what has been looked at.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-ws-'));
  forgetPages();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function write(rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** the problems, as `file: message` with nothing opened first */
async function sweep(props: Parameters<typeof diagnoseWorkspace>[0] | undefined = undefined) {
  const { problems } = await diagnoseWorkspace({ workspaceFolder: root, ...props });
  return problems
    .flatMap(p => p.diagnostics.map(d => `${path.basename(p.filePath)}: ${d.message}`))
    .sort();
}

describe('a project nobody has opened', () => {
  beforeEach(() => {
    write('package.json', JSON.stringify({ name: 's', dependencies: { markout: '^0.4.0' } }));
  });

  it('reports the pages that are broken', async () => {
    write('ok.html', '<html :n=${1}><body>${n}</body></html>');
    write('bad.html', '<html><body>${nope}</body></html>');
    expect(await sweep()).toStrictEqual(['bad.html: Unknown reference: "nope"']);
  });

  it('reports a broken FRAGMENT, at its own line', async () => {
    // a fragment is never compiled on its own here and does not need to be:
    // compiling a page reports what its imports got wrong, in the file they
    // got it wrong in
    write(
      'lib.htm',
      '<lib>\n  <:define tag="x-a:div" :title=${1}>\n    <h2>${titel}</h2>\n  </:define>\n</lib>'
    );
    write('index.html', '<html><head><:import src="/lib.htm" /></head>\n<body><x-a /></body></html>');
    const { problems } = await diagnoseWorkspace({ workspaceFolder: root });
    expect(problems).toHaveLength(1);
    expect(path.basename(problems[0].filePath)).toBe('lib.htm');
    expect(problems[0].diagnostics[0].range.start.line).toBe(2);
  });

  it('reports one fault once, however many pages reach it', async () => {
    write('lib.htm', '<lib><:define tag="x-a:div">${nope}</:define></lib>');
    write('a.html', '<html><head><:import src="/lib.htm" /></head><body><x-a /></body></html>');
    write('b.html', '<html><head><:import src="/lib.htm" /></head><body><x-a /></body></html>');
    expect(await sweep()).toStrictEqual(['lib.htm: Unknown reference: "nope"']);
  });
});

describe('a project that is not markout\\u2019s', () => {
  it('is left alone, as it is per file', async () => {
    write('package.json', JSON.stringify({ name: 'app', dependencies: { express: '^5.0.0' } }));
    // JSP EL, which markout would read as an expression if it were asked
    write('page.html', '<html><body>Hello ${user.name}</body></html>');
    expect(await sweep()).toStrictEqual([]);
  });

  it('is checked anyway when told to be', async () => {
    write('package.json', JSON.stringify({ name: 'app' }));
    write('page.html', '<html><body>${nope}</body></html>');
    expect(await sweep({ workspaceFolder: root, enable: 'always' })).toStrictEqual([
      'page.html: Unknown reference: "nope"',
    ]);
  });

  it('says nothing at all when turned off', async () => {
    write('package.json', JSON.stringify({ name: 's', dependencies: { markout: '^0.4.0' } }));
    write('bad.html', '<html><body>${nope}</body></html>');
    expect(await sweep({ workspaceFolder: root, enable: 'never' })).toStrictEqual([]);
  });
});

describe('a project too big to sweep', () => {
  it('says how much it did not look at', async () => {
    write('package.json', JSON.stringify({ name: 's', dependencies: { markout: '^0.4.0' } }));
    for (let i = 0; i < 5; i++) {
      write(`p${i}.html`, '<html><body>${nope}</body></html>');
    }
    const { problems, skipped } = await diagnoseWorkspace({ workspaceFolder: root, limit: 2 });
    expect(problems).toHaveLength(2);
    // a bound never mentioned reads as "nothing else is wrong"
    expect(skipped).toBe(3);
  });

  it('counts only the limit, never the pages it had no opinion about', async () => {
    write('package.json', JSON.stringify({ name: 's', dependencies: { markout: '^0.4.0' } }));
    write('plain.html', '<!doctype html><html><body><p>ordinary</p></body></html>');
    write('page.html', '<html :n=${1}><body>${n}</body></html>');
    const { skipped } = await diagnoseWorkspace({ workspaceFolder: root });
    expect(skipped).toBe(0);
  });
});
