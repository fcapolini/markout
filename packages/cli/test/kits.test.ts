import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverKits, findPackage, suggestRoot } from '../src/kits';

/**
 * Discovery, and the refusals that go with it.
 *
 * Every refusal here is one that `ln -s` would make -- the equivalence the
 * whole design is held to is that an installed kit behaves as though it had
 * been symlinked into the docroot under its logical name, and a link cannot
 * be made where the name is taken. See docs/design/npm-kits.md.
 */

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** a project: a docroot, and packages installed beside it */
function project(
  packages: Record<string, unknown>,
  files: Record<string, string> = {}
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-kits-'));
  temps.push(root);
  const docroot = path.join(root, 'site');
  fs.mkdirSync(docroot);
  for (const [name, json] of Object.entries(packages)) {
    // `name` may carry an install location, e.g.
    // "@markout/bootstrap-kit/node_modules/@markout/std-kit"
    const dir = path.join(root, 'node_modules', ...name.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json));
  }
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(docroot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return docroot;
}

const KIT = (name: string, root: string) => ({ name, [`markout`]: { root } });

describe('discoverKits', () => {
  it('finds a scoped kit and reads its declared root', () => {
    const docroot = project({
      '@markout/bootstrap-kit': KIT('@markout/bootstrap-kit', '/bootstrap-kit'),
    });
    const { kits, errors } = discoverKits(docroot);
    expect(errors).toEqual([]);
    expect(kits).toHaveLength(1);
    expect(kits[0].name).toBe('@markout/bootstrap-kit');
    expect(kits[0].root).toBe('/bootstrap-kit');
  });

  it('ignores an ordinary dependency', () => {
    const docroot = project({ express: { name: 'express' } });
    expect(discoverKits(docroot).kits).toEqual([]);
  });

  it('finds a kit installed inside another kit', () => {
    // the transitive case: bootstrap-kit depends on std-kit, and a version
    // conflict puts std-kit's copy under bootstrap-kit rather than beside it
    const docroot = project({
      '@markout/bootstrap-kit': KIT('@markout/bootstrap-kit', '/bootstrap-kit'),
      '@markout/bootstrap-kit/node_modules/@markout/std-kit': KIT(
        '@markout/std-kit',
        '/std-kit'
      ),
    });
    const { kits, errors } = discoverKits(docroot);
    expect(errors).toEqual([]);
    expect(kits.map(k => k.root).sort()).toEqual(['/bootstrap-kit', '/std-kit']);
  });

  it('refuses two kits claiming one root', () => {
    const docroot = project({
      '@markout/bootstrap-kit': KIT('@markout/bootstrap-kit', '/kit'),
      '@acme/bootstrap-kit': KIT('@acme/bootstrap-kit', '/kit'),
    });
    const { kits, errors } = discoverKits(docroot);
    expect(kits).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('already claimed by');
  });

  it('refuses a root the docroot already occupies', () => {
    // `ln -s` would fail here, so this does too, rather than picking a side
    const docroot = project(
      { '@markout/bootstrap-kit': KIT('@markout/bootstrap-kit', '/bootstrap-kit') },
      { 'bootstrap-kit/index.html': '<html></html>' }
    );
    const { kits, errors } = discoverKits(docroot);
    expect(kits).toEqual([]);
    expect(errors[0]).toContain('the docroot already has');
  });

  it('refuses a kit that declares no root, and suggests one', () => {
    const docroot = project({
      '@markout/bootstrap-kit': { name: '@markout/bootstrap-kit', markout: {} },
    });
    const { kits, errors } = discoverKits(docroot);
    expect(kits).toEqual([]);
    expect(errors[0]).toContain('no markout.root');
    // suggested, never applied: the ergonomics without the coupling
    expect(errors[0]).toContain('"/bootstrap-kit"');
  });

  it('refuses a root that is not a path of plain segments', () => {
    for (const root of ['/', 'bootstrap-kit', '/../escape', '/a//b', '/kit/']) {
      const docroot = project({ 'a-kit': KIT('a-kit', root) });
      const { kits, errors } = discoverKits(docroot);
      expect(kits, `root ${JSON.stringify(root)} should be refused`).toEqual([]);
      expect(errors).toHaveLength(1);
    }
  });

  it('refuses a root under /npm, which the import spelling owns', () => {
    const docroot = project({ 'a-kit': KIT('a-kit', '/npm') });
    const { errors } = discoverKits(docroot);
    expect(errors[0]).toContain('reserved');
  });

  it('accepts a multi-segment root', () => {
    // so a kit can stay out of the top level and squat less
    const docroot = project({ 'a-kit': KIT('a-kit', '/vendor/a-kit') });
    expect(discoverKits(docroot).kits[0].root).toBe('/vendor/a-kit');
  });
});

describe('findPackage', () => {
  it('walks up through node_modules', () => {
    const docroot = project({ '@markout/std-kit': KIT('@markout/std-kit', '/std-kit') });
    const deep = path.join(docroot, 'a', 'b');
    fs.mkdirSync(deep, { recursive: true });
    expect(findPackage('@markout/std-kit', deep)).toBe(
      path.join(docroot, '..', 'node_modules', '@markout', 'std-kit')
    );
  });

  it('prefers the copy installed for the importing package', () => {
    const docroot = project({
      '@markout/std-kit': KIT('@markout/std-kit', '/std-kit'),
      '@markout/bootstrap-kit': KIT('@markout/bootstrap-kit', '/bootstrap-kit'),
      '@markout/bootstrap-kit/node_modules/@markout/std-kit': KIT(
        '@markout/std-kit',
        '/std-kit'
      ),
    });
    const bootstrap = path.join(
      docroot, '..', 'node_modules', '@markout', 'bootstrap-kit'
    );
    expect(findPackage('@markout/std-kit', bootstrap)).toBe(
      path.join(bootstrap, 'node_modules', '@markout', 'std-kit')
    );
  });

  it('is undefined for a package that is not installed', () => {
    const docroot = project({});
    expect(findPackage('@markout/nope', docroot)).toBeUndefined();
  });
});

describe('suggestRoot', () => {
  it('drops the scope', () => {
    expect(suggestRoot('@markout/bootstrap-kit')).toBe('/bootstrap-kit');
    expect(suggestRoot('bootstrap-kit')).toBe('/bootstrap-kit');
  });
});
