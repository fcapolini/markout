import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The extension does not carry a web server into the editor.
 *
 * This is the claim the whole monorepo split was made to satisfy -- see
 * docs/design/monorepo.md, where the language server is named as the forcing
 * case and everything else is described as something that could have limped
 * along in one package. So it is worth an assertion rather than an intention:
 * one careless import of `@markout-lang/express`, or of the CLI's main entry,
 * and an editor process is running express, compression and commander for no
 * reason.
 *
 * ## Why this asserts REACHABILITY and not the declared closure
 *
 * It used to read `dependencies` in each package.json and forbid the CLI
 * outright. That was exactly right while the extension wanted nothing from
 * the CLI. It stopped being right when the sidebar had to install a kit the
 * same way `markout add` does -- one feature with two halves, which must not
 * drift -- and the installer is the CLI's, not the compiler's: fetching a
 * tarball, checking a hash and unpacking an archive is infrastructure, and
 * core is the compiler.
 *
 * So the CLI is now a dependency, reached through ONE subpath,
 * `@markout-lang/cli/kits`, which exports the installer and nothing else. A
 * declared-closure test cannot see that difference -- it would fail on a
 * surgical import and pass on a careless one the moment somebody added
 * express to core. What follows walks the imports instead, which is the thing
 * the rule was always about.
 *
 * ## The sidecar is not an exception to the rule, it is the rule
 *
 * `dist/markout-cli.js` is the whole `markout` command, express and commander
 * included, bundled into the archive. It is not a hole in any of this,
 * because **the rule is about a PROCESS and not about an archive**: the
 * editor's extension host must not be running a web server. The sidecar is
 * spawned, never required -- `process.execPath` and a child process -- so
 * nothing in it is ever loaded into the host.
 *
 * The last two tests here are what keep that honest. Bundling it is what
 * makes a preview possible for somebody with no npm and no node on their
 * PATH, and it would be a poor trade to buy that by letting express into
 * `client.js` unnoticed.
 */

const ROOT = path.resolve(__dirname, '../../..');

/** what must never be reachable from the editor's process */
const FORBIDDEN = ['express', 'compression', 'commander', '@markout-lang/express'];

/** the one subpath of the CLI the extension may reach, and its entry point */
const KITS_SUBPATH = '@markout-lang/cli/kits';
const KITS_ENTRY = 'packages/cli/src/kits/index.ts';

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

/**
 * Every module specifier a file imports, relative ones included.
 *
 * Anchored to the start of a line, as the layering tests' twin is, so that a
 * DOC COMMENT showing an import is not read as one -- `dom.ts` documents
 * itself with `import * as dom from '@markout-lang/html/dom'`, which is a
 * package nobody depends on and a failure nobody could act on.
 */
function importsOf(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const from = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  const bare = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  return [...text.matchAll(from), ...text.matchAll(bare)].map(m => m[1]);
}

/**
 * Every PACKAGE reachable from `entry`, following relative imports.
 *
 * Relative imports are followed because they are inside the same package and
 * can reach anything it has; a bare specifier is recorded and not followed,
 * since what a parser depends on is npm's business and none of the forbidden
 * names is under one.
 */
function packagesReachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    const real = path.resolve(file);
    if (seen.has(real) || !fs.existsSync(real)) {
      return;
    }
    seen.add(real);
    for (const spec of importsOf(real)) {
      if (!spec.startsWith('.')) {
        packages.add(spec);
        continue;
      }
      const base = path.resolve(path.dirname(real), spec);
      for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) {
          visit(candidate);
          break;
        }
      }
    }
  };
  visit(path.join(ROOT, entry));
  return packages;
}

describe('what the extension can reach', () => {
  it('imports the CLI only through its kits subpath', () => {
    // the whole boundary in one assertion: `@markout-lang/cli` bare is the
    // command's entry point, and pulls the server it is built on
    const offenders = sourceFiles(path.join(ROOT, 'packages/vscode/src'))
      .flatMap(file =>
        importsOf(file)
          .filter(spec => spec.startsWith('@markout-lang/cli'))
          .map(spec => `${path.relative(ROOT, file)}: ${spec}`)
      )
      .filter(line => !line.endsWith(KITS_SUBPATH));
    expect(offenders).toStrictEqual([]);
  });

  it('imports no web server of its own', () => {
    const reached = sourceFiles(path.join(ROOT, 'packages/vscode/src')).flatMap(importsOf);
    expect(reached.filter(spec => FORBIDDEN.includes(spec))).toStrictEqual([]);
  });

  it('reaches no web server through the kits subpath either', () => {
    // the import above is only safe while what it lands on stays clean, and
    // "stays clean" is a property of a file somebody else maintains
    const reached = packagesReachableFrom(KITS_ENTRY);
    expect([...reached].filter(spec => FORBIDDEN.includes(spec))).toStrictEqual([]);
  });

  it('would notice if the walk stopped working', () => {
    // the CLI's MAIN entry is the package that legitimately has all of it, so
    // finding nothing there would mean the walk is looking at nothing
    const reached = packagesReachableFrom('packages/cli/src/index.ts');
    expect([...reached].filter(spec => FORBIDDEN.includes(spec)).sort()).toStrictEqual([
      '@markout-lang/express',
      'compression',
      'express',
    ]);
  });

  it('spawns the sidecar and never requires it', () => {
    // the distinction the whole boundary now rests on: a bundled server in
    // the archive is fine, a loaded one is not
    const sources = sourceFiles(path.join(ROOT, 'packages/vscode/src'));
    const mentions = sources.filter(file =>
      fs.readFileSync(file, 'utf8').includes('markout-cli.js')
    );
    expect(mentions.map(f => path.basename(f))).toStrictEqual(['preview.ts']);
    const preview = fs.readFileSync(path.join(ROOT, 'packages/vscode/src/preview.ts'), 'utf8');
    // matched across whitespace: the argument is what matters and a line
    // break between it and the call is a formatting decision, not a change
    // of behaviour
    expect(preview).toMatch(/spawn\(\s*process\.execPath/);
    // never reached by a module specifier, which is the only way it could
    // end up inside the extension host
    expect(importsOf(path.join(ROOT, 'packages/vscode/src/preview.ts'))).not.toContain(
      './markout-cli.js'
    );
  });

  it('keeps the compiler free of the installer', () => {
    // core is the compiler: it reads and writes `.markout/kits.json`, because
    // it reports a declared kit that is not installed -- and it never fetches
    const reached = packagesReachableFrom('packages/core/src/index.ts');
    expect([...reached].filter(spec => spec.startsWith('@markout-lang/'))).toStrictEqual([]);
    expect(fs.existsSync(path.join(ROOT, 'packages/core/src/install'))).toBe(false);
  });
});
