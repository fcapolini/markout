import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findDocroot,
  isBumpPending,
  isNewer,
  managedKitDir,
  pagesUsing,
  pendingBumps,
  projectKits,
  refusedKits,
  shortenPaths,
  type KitRow,
} from '../src/kits-model';

/**
 * What the sidebar shows, and why each row says what it says.
 *
 * The editor-free half: every decision here is about MEANING -- installed by
 * whom, removable by whom, out of date or deliberately not -- and none of it
 * needs a TreeDataProvider to be worth getting right. See
 * docs/design/without-node.md.
 */

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

function project(): { root: string; docroot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-sidebar-'));
  temps.push(root);
  const docroot = path.join(root, 'markout');
  fs.mkdirSync(docroot);
  return { root, docroot };
}

function install(root: string, into: string, name: string, version: string, kitRoot?: string) {
  const dir = path.join(root, ...into.split('/'), ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name,
      version,
      description: `the ${name} kit`,
      markout: { root: kitRoot ?? '/' + name.split('/').pop() },
    })
  );
}

function manifest(root: string, kits: Record<string, string>) {
  fs.mkdirSync(path.join(root, '.markout'), { recursive: true });
  fs.writeFileSync(path.join(root, '.markout', 'kits.json'), JSON.stringify({ kits }));
}

/** what the registry would have answered, as the sidebar passes it in */
const OFFERED = [
  { name: '@markout-lang/bootstrap-kit', description: 'Bootstrap 5.3 as components' },
  { name: '@markout-lang/std-kit', description: 'Data sources and formatting' },
];

describe('projectKits', () => {
  it('shows an installed kit with the version the compiler found', () => {
    // "installed" here means discovery agrees, not that a manifest claimed it
    const { root, docroot } = project();
    install(root, '.markout/kits', 'a-kit', '1.0.0');
    const found = projectKits(docroot, root);
    const a = found.rows.find(r => r.name === 'a-kit')!;
    expect(a.installed).toBe('1.0.0');
    expect(a.managed).toBe(true);
    expect(a.missing).toBeUndefined();
    expect(a.description).toBe('the a-kit kit');
  });

  it('marks an npm-installed kit as not managed', () => {
    // the checkbox must not edit somebody's node_modules; the row still
    // shows, because it IS installed and a user looking for it should find it
    const { root, docroot } = project();
    install(root, 'node_modules', 'a-kit', '1.0.0');
    expect(projectKits(docroot, root).rows.find(r => r.name === 'a-kit')!.managed).toBe(
      false
    );
  });

  it('marks a declared kit that is not installed as missing', () => {
    // the only way the sidebar can tell MISSING from merely absent, and the
    // reason the manifest exists at all
    const { root, docroot } = project();
    manifest(root, { 'a-kit': '1.0.0' });
    const a = projectKits(docroot, root).rows.find(r => r.name === 'a-kit')!;
    expect(a.missing).toBe(true);
    expect(a.pinned).toBe('1.0.0');
    expect(a.installed).toBeUndefined();
  });

  it('offers what it was given to an empty project', () => {
    // something to tick, rather than a search box and no idea what to type
    const { root, docroot } = project();
    const rows = projectKits(docroot, root, OFFERED).rows;
    expect(rows.map(r => r.name)).toContain('@markout-lang/bootstrap-kit');
    expect(rows.every(r => !r.installed)).toBe(true);
  });

  it('offers nothing when nothing was given, which is also being offline', () => {
    // the list comes from the registry; with no network there is nothing to
    // offer, and nothing is lost that was not already lost -- installing
    // needs the registry too
    const { root, docroot } = project();
    expect(projectKits(docroot, root).rows).toEqual([]);
  });

  it('does not offer a kit twice once it is installed', () => {
    const { root, docroot } = project();
    install(root, '.markout/kits', '@markout-lang/std-kit', '1.0.0', '/std-kit');
    const rows = projectKits(docroot, root, OFFERED).rows.filter(
      r => r.name === '@markout-lang/std-kit'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].installed).toBe('1.0.0');
  });

  it('orders installed first, then missing, then the rest', () => {
    // a row should not move because a version changed
    const { root, docroot } = project();
    install(root, '.markout/kits', 'z-kit', '1.0.0');
    manifest(root, { 'm-kit': '1.0.0', 'z-kit': '1.0.0' });
    const rows = projectKits(docroot, root).rows;
    expect(rows[0].name).toBe('z-kit');
    expect(rows[1].name).toBe('m-kit');
  });

  it("passes discovery's refusals through, where the user can act on them", () => {
    const { root, docroot } = project();
    install(root, '.markout/kits', 'a-kit', '1.0.0', '/same');
    install(root, '.markout/kits', 'b-kit', '1.0.0', '/same');
    expect(projectKits(docroot, root).errors[0]).toContain('already claimed by');
  });
});

describe('isNewer', () => {
  it('orders by segment, numerically', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true);
    expect(isNewer('1.2.0', '1.10.0')).toBe(false);
    expect(isNewer('2.0.0', '1.99.99')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
  });

  it('puts a release above the prerelease it follows', () => {
    expect(isNewer('1.0.0', '1.0.0-beta.1')).toBe(true);
    expect(isNewer('1.0.0-beta.1', '1.0.0')).toBe(false);
  });
});

describe('isBumpPending', () => {
  const base: KitRow = { name: 'a-kit', installed: '1.0.0', managed: true };

  it('is pending when the registry has something newer', () => {
    expect(isBumpPending({ ...base, available: '1.1.0' }, {})).toBe(true);
  });

  it('is not pending for a kit that is not installed', () => {
    expect(isBumpPending({ name: 'a-kit', managed: true, available: '1.1.0' }, {})).toBe(
      false
    );
  });

  it('is not pending when the registry is behind or level', () => {
    expect(isBumpPending({ ...base, available: '1.0.0' }, {})).toBe(false);
    expect(isBumpPending({ ...base, available: '0.9.0' }, {})).toBe(false);
  });

  it('stops asking about a version that was declined', () => {
    expect(isBumpPending({ ...base, available: '1.1.0' }, { 'a-kit': '1.1.0' })).toBe(false);
  });

  it('asks again when a later version arrives', () => {
    // declining is "not this one", not "never" -- a flag would make the
    // button one nobody dares press
    expect(isBumpPending({ ...base, available: '1.2.0' }, { 'a-kit': '1.1.0' })).toBe(true);
  });
});

describe('pendingBumps', () => {
  it('counts what the badge shows', () => {
    const rows: KitRow[] = [
      { name: 'a', installed: '1.0.0', available: '1.1.0', managed: true },
      { name: 'b', installed: '1.0.0', available: '1.0.0', managed: true },
      { name: 'c', installed: '1.0.0', available: '2.0.0', managed: true },
    ];
    expect(pendingBumps(rows, {})).toBe(2);
    expect(pendingBumps(rows, { c: '2.0.0' })).toBe(1);
  });
});

describe('pagesUsing', () => {
  it('finds the /npm/ spelling', () => {
    const { docroot } = project();
    fs.writeFileSync(
      path.join(docroot, 'index.html'),
      '<html><:import src="/npm/@markout-lang/bootstrap-kit/all.htm"/></html>'
    );
    expect(pagesUsing(docroot, { name: '@markout-lang/bootstrap-kit' })).toEqual([
      'index.html',
    ]);
  });

  it('finds the mounted-root spelling', () => {
    // both are how a page reaches a kit's files, so both are the surface
    const { docroot } = project();
    fs.writeFileSync(
      path.join(docroot, 'index.html'),
      '<html><link rel="stylesheet" href="/bootstrap-kit/css/all.css"></html>'
    );
    expect(
      pagesUsing(docroot, { name: '@markout-lang/bootstrap-kit', root: '/bootstrap-kit' })
    ).toEqual(['index.html']);
  });

  it('is empty when nothing mentions the kit', () => {
    const { docroot } = project();
    fs.writeFileSync(path.join(docroot, 'index.html'), '<html><body>hi</body></html>');
    expect(pagesUsing(docroot, { name: 'a-kit', root: '/a-kit' })).toEqual([]);
  });

  it('names every page, so a refusal can list them', () => {
    const { docroot } = project();
    fs.mkdirSync(path.join(docroot, 'sub'));
    for (const rel of ['index.html', 'sub/about.html']) {
      fs.writeFileSync(
        path.join(docroot, rel),
        '<:import src="/npm/a-kit/all.htm"/>'
      );
    }
    expect(pagesUsing(docroot, { name: 'a-kit' }).sort()).toEqual([
      'index.html',
      path.join('sub', 'about.html'),
    ]);
  });
});

describe('managedKitDir', () => {
  it('is the directory a removal has to delete', () => {
    expect(managedKitDir('/p', '@scope/a-kit')).toBe(
      path.join('/p', '.markout', 'kits', '@scope', 'a-kit')
    );
  });
});

describe('findDocroot', () => {
  it('finds the conventional directory inside the folder', () => {
    // the bug this exists for: `docrootFor` answers "which docroot does this
    // FILE belong to" by walking up, so handed an invented path at the folder
    // root it can only ever answer with the folder -- and the sidebar then
    // reported no markout project for a project the rest of the extension
    // was handling correctly
    const { root, docroot } = project();
    fs.writeFileSync(path.join(docroot, 'index.html'), '<html></html>');
    expect(findDocroot([root], undefined)).toBe(docroot);
  });

  it('prefers what markout.docroot names, having been said explicitly', () => {
    const { root } = project();
    const pages = path.join(root, 'site');
    fs.mkdirSync(pages);
    manifest(root, {});
    expect(findDocroot([root], 'site')).toBe(pages);
    expect(findDocroot([root], ['site'])).toBe(pages);
  });

  it('takes the folder itself when the pages are simply in it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-sidebar-'));
    temps.push(root);
    manifest(root, { 'a-kit': '1.0.0' });
    expect(findDocroot([root], undefined)).toBe(root);
  });

  it('is nothing for a folder that is not a markout project', () => {
    // the gate that keeps this extension from being a nuisance
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-sidebar-'));
    temps.push(root);
    fs.writeFileSync(path.join(root, 'index.html'), '<html>plain</html>');
    expect(findDocroot([root], undefined)).toBeUndefined();
  });

  it('takes the first folder that answers, out of several', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-sidebar-'));
    temps.push(plain);
    const { root, docroot } = project();
    expect(findDocroot([plain, root], undefined)).toBe(docroot);
  });

  it('ignores a configured docroot that is not there', () => {
    const { root, docroot } = project();
    expect(findDocroot([root], 'nowhere')).toBe(docroot);
  });
});

describe('refusedKits', () => {
  it('names the kit in each shape of refusal', () => {
    expect(
      refusedKits([
        'kit "@a/one" declares markout.root "x", which is not an absolute path',
        'package "@a/two" has a "markout" section but no markout.root -- add one',
        'kit "@a/three" claims root "/x", but the docroot already has "/p/x"',
      ])
    ).toEqual(['@a/one', '@a/two', '@a/three']);
  });

  it('names the kit REFUSED, and not the one it lost to', () => {
    // `kit "X" claims root R, already claimed by "Y"` refuses X and mounts
    // Y. Y is installed and has a row saying so; taking it for refused as
    // well would be reading the message backwards
    expect(
      refusedKits([
        'kit "@a/loser" claims root "/x", already claimed by "@a/winner" -- one of them',
      ])
    ).toEqual(['@a/loser']);
  });

  it('is empty for a message naming none', () => {
    expect(refusedKits(['something else went wrong'])).toEqual([]);
  });
});

describe('a refused kit is not also offered', () => {
  it('leaves it to its refusal, having one', () => {
    // it IS installed -- that is why there is something to refuse -- so an
    // unticked row inviting an install would fetch a second copy and fix
    // nothing
    const { root, docroot } = project();
    // a directory in the docroot claiming the root the kit wants
    fs.mkdirSync(path.join(docroot, 'std-kit'));
    install(root, 'node_modules', '@markout-lang/std-kit', '1.0.0', '/std-kit');
    const found = projectKits(docroot, root, [
      { name: '@markout-lang/std-kit', description: 'offered' },
    ]);
    expect(found.errors[0]).toContain('the docroot already has');
    expect(found.rows.map(r => r.name)).not.toContain('@markout-lang/std-kit');
  });

  it('still offers the kits nothing was said about', () => {
    const { root, docroot } = project();
    fs.mkdirSync(path.join(docroot, 'std-kit'));
    install(root, 'node_modules', '@markout-lang/std-kit', '1.0.0', '/std-kit');
    const found = projectKits(docroot, root, [
      { name: '@markout-lang/std-kit' },
      { name: '@markout-lang/bootstrap-kit' },
    ]);
    expect(found.rows.map(r => r.name)).toEqual(['@markout-lang/bootstrap-kit']);
  });
});

describe('shortenPaths', () => {
  it('makes the project\'s own paths relative', () => {
    const msg = 'the docroot already has "/home/me/site/bootstrap-kit" -- preferring';
    expect(shortenPaths(msg, '/home/me/site')).toBe(
      'the docroot already has "bootstrap-kit" -- preferring'
    );
  });

  it('leaves a path that is not under a root alone', () => {
    const msg = 'at "/elsewhere/kit"';
    expect(shortenPaths(msg, '/home/me/site')).toBe(msg);
  });

  it('takes the longest root first, so a nested one is not half-replaced', () => {
    // `.markout/kits` lives under the project, and replacing the shorter
    // root first would leave "kits/a-kit" rather than "a-kit"
    const msg = 'at "/p/.markout/kits/a-kit"';
    expect(shortenPaths(msg, '/p', '/p/.markout/kits')).toBe('at "a-kit"');
  });

  it('shortens the root itself to a dot rather than to nothing', () => {
    expect(shortenPaths('at "/p"', '/p')).toBe('at "."');
  });
});
