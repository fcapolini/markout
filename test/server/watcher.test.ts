import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { TreeWatcher, watchTree } from '../../src/server/watcher';

/**
 * The regression here is the second test: a recursive `fs.watch` does not
 * descend through a symlink, so a kit reached by one -- which is what
 * `kits/bootstrap/std-kit` is -- could be edited without any page that
 * imported it being recompiled.
 *
 * The `count` assertions pin decisions rather than timing: `node_modules` is
 * deliberately not watched (see docs/design/npm-kits.md), and a link that leads back
 * into an already-watched tree must not add a watcher or the walk would not
 * terminate.
 */

const made: { dir: string; watcher?: TreeWatcher }[] = [];

afterEach(() => {
  while (made.length) {
    const m = made.pop()!;
    m.watcher?.close();
    fs.existsSync(m.dir) && fs.rmSync(m.dir, { recursive: true, force: true });
  }
});

function tempTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-watch-'));
  made.push({ dir });
  return dir;
}

function start(docroot: string, onChange: () => void): TreeWatcher {
  const watcher = watchTree(docroot, onChange);
  made[made.length - 1].watcher = watcher;
  return watcher;
}

function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      if (pred()) return resolve(true);
      if (Date.now() - start > ms) return resolve(false);
      setTimeout(tick, 25).unref?.();
    };
    tick();
  });
}

/**
 * Keep making the change until the watcher reports it.
 *
 * Writing once and waiting is what a first version did, and it failed about
 * half the time under a loaded suite. Not because notification is slow --
 * though it is not prompt either -- but because `fs.watch` is not armed the
 * instant it returns: a write in that window produces no event AT ALL, so
 * there is nothing a longer timeout can wait for. Repeating the write is the
 * only thing that distinguishes "the watcher is not working" from "the watcher
 * was not ready yet".
 */
async function eventually(change: () => void, fired: () => boolean, ms = 4000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    change();
    if (await waitFor(fired, 150)) {
      return true;
    }
  }
  return false;
}

describe('watchTree', () => {
  it('fires for a change directly under the docroot', async () => {
    const root = tempTree();
    const docroot = path.join(root, 'site');
    fs.mkdirSync(docroot);
    let fired = 0;
    start(docroot, () => fired++);

    const page = path.join(docroot, 'index.html');
    let n = 0;
    expect(
      await eventually(() => fs.writeFileSync(page, `<html>${n++}</html>`), () => fired > 0)
    ).toBe(true);
  }, 10000);

  it('fires for a change reached through a symlinked directory', async () => {
    // the whole point: `fs.watch(docroot, {recursive: true})` alone sees
    // nothing of this, which is the bug `kits/bootstrap/std-kit` had
    const root = tempTree();
    const docroot = path.join(root, 'site');
    const kit = path.join(root, 'kit', 'parts');
    fs.mkdirSync(docroot);
    fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(path.join(kit, 'card.htm'), '<div></div>');
    fs.symlinkSync(path.join(root, 'kit'), path.join(docroot, 'kit'));

    let fired = 0;
    const watcher = start(docroot, () => fired++);
    expect(watcher.count).toBe(2);

    const card = path.join(kit, 'card.htm');
    let n = 0;
    expect(
      await eventually(() => fs.writeFileSync(card, `<div>${n++}</div>`), () => fired > 0)
    ).toBe(true);
  }, 10000);

  it('follows a symlink found inside a symlinked directory', () => {
    const root = tempTree();
    const docroot = path.join(root, 'site');
    fs.mkdirSync(docroot);
    fs.mkdirSync(path.join(root, 'a'));
    fs.mkdirSync(path.join(root, 'b'));
    fs.symlinkSync(path.join(root, 'a'), path.join(docroot, 'a'));
    fs.symlinkSync(path.join(root, 'b'), path.join(root, 'a', 'b'));

    // docroot, a, and b: the third is only reachable by looking inside the
    // second, which is the case a single pass would miss
    expect(start(docroot, () => {}).count).toBe(3);
  });

  it('does not watch node_modules', () => {
    const root = tempTree();
    const docroot = path.join(root, 'site');
    fs.mkdirSync(path.join(docroot, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'kit'));
    fs.symlinkSync(path.join(root, 'kit'), path.join(docroot, 'node_modules', 'kit'));

    expect(start(docroot, () => {}).count).toBe(1);
  });

  it('does not watch dot-prefixed directories', () => {
    const root = tempTree();
    const docroot = path.join(root, 'site');
    fs.mkdirSync(path.join(docroot, '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'elsewhere'));
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(docroot, '.git', 'link'));

    expect(start(docroot, () => {}).count).toBe(1);
  });

  it('terminates on a link that leads back into the watched tree', () => {
    const root = tempTree();
    const docroot = path.join(root, 'site');
    fs.mkdirSync(docroot);
    fs.symlinkSync(docroot, path.join(docroot, 'self'));

    expect(start(docroot, () => {}).count).toBe(1);
  });

  it('ignores a dangling link', () => {
    const root = tempTree();
    const docroot = path.join(root, 'site');
    fs.mkdirSync(docroot);
    fs.symlinkSync(path.join(root, 'gone'), path.join(docroot, 'gone'));

    expect(start(docroot, () => {}).count).toBe(1);
  });
});
