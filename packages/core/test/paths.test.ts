import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverKits } from '../src/kits';
import { contains, normalizeSeparators, Resolver } from '../src/paths';

/**
 * The containment rules, tested where they live rather than only through
 * the preprocessor and the middleware that used to own a copy each.
 *
 * Two of these pin decisions rather than behaviour -- that an escape is
 * refused instead of being normalized into an ordinary lookup, and that the
 * test is lexical. Both are the kind of thing a later reader could
 * reasonably mistake for an oversight and "fix", which is exactly why they
 * are written down twice: here, and in docs/design/npm-kits.md.
 */

let tempRoot: string;
let docroot: string;
const mounts: string[] = [];

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-paths-'));
  docroot = path.join(tempRoot, 'site');
  fs.mkdirSync(docroot);
  fs.mkdirSync(path.join(tempRoot, 'site-secret'));
  fs.writeFileSync(path.join(tempRoot, 'site-secret', 'passwd.html'), 'TOP SECRET');
});

afterAll(() => {
  fs.existsSync(tempRoot) && fs.rmSync(tempRoot, { recursive: true });
  mounts.forEach(d => fs.existsSync(d) && fs.rmSync(d, { recursive: true, force: true }));
});

describe('Resolver', () => {
  it('resolves a relative spec against the current directory', () => {
    const r = new Resolver(docroot).resolve('button.htm', '/parts');
    expect(r.ok).toBe(true);
    r.ok && expect(r.pathname).toBe('/parts/button.htm');
    r.ok && expect(r.filePath).toBe(path.join(docroot, 'parts', 'button.htm'));
  });

  it('ignores the current directory for an absolute spec', () => {
    const r = new Resolver(docroot).resolve('/all.htm', '/parts');
    expect(r.ok).toBe(true);
    r.ok && expect(r.pathname).toBe('/all.htm');
  });

  it('resolves `..` that stays inside the root', () => {
    const r = new Resolver(docroot).resolve('../all.htm', '/parts');
    expect(r.ok).toBe(true);
    r.ok && expect(r.pathname).toBe('/all.htm');
  });

  it('refuses a sibling directory sharing the docroot prefix', () => {
    // the hazard the trailing separator exists for: "/…/site-secret" starts
    // with "/…/site" and is not below it
    expect(new Resolver(docroot).resolve('../site-secret/passwd.html', '/')).toMatchObject({
      ok: false,
      kind: 'forbidden',
      escaped: '../site-secret/passwd.html',
    });
  });

  it('refuses an escape rather than normalizing it into a lookup', () => {
    // `path.posix.normalize('/../site-secret/x')` is `/site-secret/x`, so
    // normalizing the LOGICAL path first would turn this refusal into a
    // docroot-relative miss -- trading an error that names the mistake for a
    // 404 that does not. Resolution happens on the filesystem side for
    // exactly this reason.
    expect(new Resolver(docroot).resolve('/../site-secret/passwd.html')).toMatchObject({
      ok: false,
      kind: 'forbidden',
      escaped: '../site-secret/passwd.html',
    });
  });

  it('is lexical: a symlink out of the root is NOT refused', () => {
    // Deliberate, and load-bearing for kits: under pnpm every installed
    // package is a symlink into a store outside the project, so a
    // realpath-based test would refuse every legitimate install. Containment
    // answers "did the logical path escape its root", not "these bytes came
    // from inside it".
    const link = path.join(docroot, 'linked');
    fs.symlinkSync(path.join(tempRoot, 'site-secret'), link);
    const r = new Resolver(docroot).resolve('/linked/passwd.html');
    expect(r.ok).toBe(true);
    r.ok && expect(r.pathname).toBe('/linked/passwd.html');
  });

  it('accepts the root itself', () => {
    const r = new Resolver(docroot).resolve('/');
    expect(r.ok).toBe(true);
    r.ok && expect(r.pathname).toBe('/');
  });
});

describe('contains', () => {
  it('accepts the directory itself and anything below it', () => {
    expect(contains('/a/site', '/a/site')).toBe(true);
    expect(contains('/a/site', path.join('/a/site', 'x', 'y'))).toBe(true);
  });

  it('refuses a sibling sharing the prefix', () => {
    expect(contains('/a/site', '/a/site-other')).toBe(false);
    expect(contains('/a/site', '/a/site-other/secret')).toBe(false);
  });

  it('refuses an ancestor', () => {
    expect(contains('/a/site', '/a')).toBe(false);
  });
});

describe('mounted kits', () => {
  const kitted = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-mount-'));
    mounts.push(root);
    const site = path.join(root, 'site');
    fs.mkdirSync(site);
    const install = (name: string, json: unknown) => {
      const dir = path.join(root, 'node_modules', ...name.split('/'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json));
      return dir;
    };
    const kitDir = install('@markout/bootstrap-kit', {
      name: '@markout/bootstrap-kit',
      markout: { root: '/bootstrap-kit' },
    });
    install('express', { name: 'express' });
    return { site, kitDir, resolver: new Resolver(site, discoverKits(site).kits) };
  };

  it('resolves a mounted pathname into the package directory', () => {
    const { kitDir, resolver } = kitted();
    const r = resolver.resolve('/bootstrap-kit/res/logo.png');
    expect(r.ok).toBe(true);
    r.ok && expect(r.filePath).toBe(path.join(kitDir, 'res', 'logo.png'));
    r.ok && expect(r.root.kit?.name).toBe('@markout/bootstrap-kit');
  });

  it('gives a /npm/ spec the kit\'s own logical identity', () => {
    // the two spellings name one file, so `<:import>`'s once-only rule --
    // which dedups on this pathname -- holds across both
    const { kitDir, resolver } = kitted();
    const r = resolver.resolve('/npm/@markout/bootstrap-kit/all.htm');
    expect(r.ok).toBe(true);
    r.ok && expect(r.pathname).toBe('/bootstrap-kit/all.htm');
    r.ok && expect(r.filePath).toBe(path.join(kitDir, 'all.htm'));
  });

  it('resolves a relative include from inside a kit within that kit', () => {
    const { kitDir, resolver } = kitted();
    const r = resolver.resolve('./button.htm', '/bootstrap-kit/parts');
    expect(r.ok).toBe(true);
    r.ok && expect(r.filePath).toBe(path.join(kitDir, 'parts', 'button.htm'));
  });

  it('refuses a path escaping its mount', () => {
    const { resolver } = kitted();
    expect(resolver.resolve('/bootstrap-kit/../../secret')).toMatchObject({
      ok: false,
      kind: 'forbidden',
    });
  });

  it('finds a mount named through a `..` segment', () => {
    // prefix matching happens on the NORMALIZED path, so this names the
    // mount as plainly as the direct spelling does
    const { resolver } = kitted();
    const r = resolver.resolve('/foo/../bootstrap-kit/res/logo.png');
    expect(r.ok).toBe(true);
    r.ok && expect(r.pathname).toBe('/bootstrap-kit/res/logo.png');
  });

  it('refuses /npm/ for a package that is not installed', () => {
    const { resolver } = kitted();
    expect(resolver.resolve('/npm/@markout/nope/all.htm')).toMatchObject({
      ok: false,
      kind: 'unresolved',
    });
  });

  it('refuses /npm/ for an installed package that is not a kit', () => {
    const { resolver } = kitted();
    const r = resolver.resolve('/npm/express/all.htm');
    expect(r.ok).toBe(false);
    !r.ok && r.kind === 'unresolved' && expect(r.message).toContain('markout.root');
  });

  it('falls through to the docroot for an unclaimed path', () => {
    const { site, resolver } = kitted();
    const r = resolver.resolve('/index.html');
    expect(r.ok).toBe(true);
    r.ok && expect(r.filePath).toBe(path.join(site, 'index.html'));
    r.ok && expect(r.root.kit).toBeUndefined();
  });

  it('prefers the longest matching root', () => {
    const outer = { name: 'outer', dir: '/tmp/outer', root: '/vendor' };
    const inner = { name: 'inner', dir: '/tmp/inner', root: '/vendor/inner' };
    const resolver = new Resolver('/tmp/site', [outer, inner]);
    expect(resolver.rootFor('/vendor/inner/x.htm').kit?.name).toBe('inner');
    expect(resolver.rootFor('/vendor/other/x.htm').kit?.name).toBe('outer');
  });
});

describe('normalizeSeparators', () => {
  it('is idempotent on a forward-slash path', () => {
    expect(normalizeSeparators('a/b/c.htm')).toBe('a/b/c.htm');
  });

  it('converts backslashes and mixed separators', () => {
    expect(normalizeSeparators('a\\b/c\\d.htm')).toBe('a/b/c/d.htm');
  });
});
