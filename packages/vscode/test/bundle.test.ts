import { execFileSync } from 'child_process';
import fs from 'fs';
import { builtinModules } from 'module';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * What the bundles reach for, which decides whether an installed one runs.
 *
 * A `.vsix` is unzipped somewhere with no `npm install` behind it, so every
 * `require` the two bundles still perform has to be answerable by node or by
 * the extension host. One that is not is invisible everywhere it is easy to
 * look: `vscode-html-languageservice` ships UMD, whose wrapper passes
 * `require` in as an ARGUMENT, and a shadowed `require` is one esbuild leaves
 * standing -- so the server built clean, packaged clean, installed clean and
 * died on its first question with "Cannot find module ./parser/htmlScanner".
 *
 * Built into a directory of its own rather than read out of `dist/`: the
 * suite next door builds too, and two of them writing the same file is a
 * race that would fail for a reason that has nothing to do with anything.
 */

const PACKAGE = path.resolve(__dirname, '..');
let outdir: string;

beforeAll(() => {
  outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-bundle-'));
  execFileSync(
    process.execPath,
    [path.join(PACKAGE, 'scripts', 'bundle.mjs'), '--outdir', outdir, '--quiet'],
    { cwd: PACKAGE, stdio: 'ignore' }
  );
}, 60000);

// `markout-cli.js` is included, and is the one most likely to fail this:
// it bundles express, which is a package full of `require` calls written
// before bundlers existed. It is also the one whose failure is quietest --
// it runs in a child process, so a missing module surfaces as a preview
// that never comes up rather than as anything in the editor.
/** what package.json points `viewsContainers` at */
const ICON = 'activity-icon.svg';

describe('what travels beside the bundles', () => {
  it('parses the activity bar icon as XML', () => {
    // an SVG that does not parse is an icon that silently does not appear,
    // and XML forbids `--` inside a comment -- which this project's comment
    // style produces without noticing
    const svg = fs.readFileSync(path.join(PACKAGE, 'media', ICON), 'utf8');
    for (const comment of svg.match(/<!--[\s\S]*?-->/g) ?? []) {
      expect(comment.slice(4, -3)).not.toContain('--');
    }
    expect(svg).toMatch(/viewBox=/);
  });

  it('declares the icon package.json points at', () => {
    // the path is a string in a manifest, so nothing else notices it going
    // stale -- and a missing icon renders as a blank square rather than an
    // error
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')
    );
    const declared = manifest.contributes.viewsContainers.activitybar[0].icon;
    expect(declared).toBe(`media/${ICON}`);
    expect(fs.existsSync(path.join(PACKAGE, declared))).toBe(true);
  });

  it('titles the view as the container, so the header is not doubled', () => {
    // a container and a view with different names renders as
    // "Markout: Kits". The same name renders once, which is what a view
    // holding everything the extension does should say
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')
    );
    const container = manifest.contributes.viewsContainers.activitybar[0];
    const view = manifest.contributes.views[container.id][0];
    expect(view.name).toBe(container.title);
    expect(view.contextualTitle).toBe(container.title);
  });

  it('draws the icon as outline, to sit with the glyphs beside it', () => {
    // every other icon in the activity bar is uniform-weight line art; a
    // filled mark reads as a blob among them
    const svg = fs.readFileSync(path.join(PACKAGE, 'media', ICON), 'utf8');
    expect(svg).toContain('fill="none"');
    expect(svg).not.toMatch(/fill="(?!none")[^"]+"/);
    // recoloured by the theme rather than baked
    expect(svg).toContain('currentColor');
    expect(svg).not.toContain('stroke="black"');
  });

  it('rounds every corner, not just the ends', () => {
    // a chevron drawn as two segments meeting at a point has two round CAPS
    // overlapping, which reads as a lump at 24px. One path per chevron with
    // a round JOIN is the corner the glyphs beside it have
    const svg = fs.readFileSync(path.join(PACKAGE, 'media', ICON), 'utf8');
    const paths = svg.match(/<path[^>]*>/g) ?? [];
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      // every path bends, so every path needs the join
      expect(p).toContain('stroke-linejoin="round"');
      expect(p).toContain('stroke-linecap="round"');
    }
  });

  it('carries the "Who is this for?" page', () => {
    // opened from disk rather than fetched, so it describes the sidebar the
    // reader has and needs no network
    const doc = fs.readFileSync(path.join(outdir, 'who-is-this-for.md'), 'utf8');
    expect(doc).toContain('# The Markout sidebar');
  });

  it('leaves no relative link in it that would resolve to nothing', () => {
    // the rest of `docs/` does not travel, so a `](../concepts/x.md)` in the
    // shipped copy is a dead link in the preview
    const doc = fs.readFileSync(path.join(outdir, 'who-is-this-for.md'), 'utf8');
    const relative = [...doc.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)].map(m => m[1]);
    expect(relative).toStrictEqual([]);
  });

  it('opens that page from disk, and not from github.com', () => {
    // a URL 404s for anything not yet merged, which is how the first version
    // of this was found out
    const src = fs.readFileSync(
      path.join(PACKAGE, 'src', 'sidebar.ts'),
      'utf8'
    );
    expect(src).toContain('markdown.showPreview');
    expect(src).not.toMatch(/openExternal\([^)]*github\.com/);
  });
});

describe.each(['client.js', 'server.js', 'markout-cli.js'])('%s', file => {
  it('asks for nothing by name but `vscode` and node itself', () => {
    const text = fs.readFileSync(path.join(outdir, file), 'utf8');
    const asked = new Set<string>();
    // `require2(...)` and the rest: esbuild renames a shadowed `require`,
    // and a renamed one is exactly the case it could not follow
    for (const [, id] of text.matchAll(/\brequire\d*\(\s*["']([^"']+)["']\s*\)/g)) {
      asked.add(id);
    }
    const outside = [...asked].filter(
      id => id !== 'vscode' && !builtinModules.includes(id.replace(/^node:/, ''))
    );
    expect(outside).toStrictEqual([]);
  });

  it('is a bundle rather than a re-export of the sources', () => {
    // a build that emitted a wrapper around out/ would pass the check above
    // by asking for nothing, and ship nothing
    expect(fs.statSync(path.join(outdir, file)).size).toBeGreaterThan(100_000);
  });
});

/**
 * The sidecar, launched the way the sidebar launches it.
 *
 * `preview.ts` spawns it with `process.execPath`, which in an extension host
 * is the Electron binary -- that is the whole trick, since it means no node
 * has to be found on a PATH. Commander auto-detects `process.versions.electron`
 * and, finding it, keeps argv[1] as a positional: right for a packaged
 * Electron app, wrong for a node bin. The docroot arrived as a SECOND
 * argument and the preview died with "too many arguments".
 *
 * Run against the BUNDLE rather than the sources, because that is what the
 * sidebar runs and because the difference is in how the process is launched.
 * An earlier version of this test went through tsx, which re-executes in a
 * child of its own -- so the preload never reached the process doing the
 * parsing, and the test passed with the bug in place.
 */
describe('the sidecar under an Electron-flavoured interpreter', () => {
  it('reads the docroot as the only argument', () => {
    const preload = path.join(outdir, 'as-electron.cjs');
    fs.writeFileSync(preload, "process.versions.electron = '34.0.0';\n");
    const docroot = path.join(outdir, 'markout');
    fs.mkdirSync(docroot, { recursive: true });
    fs.writeFileSync(path.join(docroot, 'index.html'), '<html><body>hi</body></html>');
    const written = path.join(outdir, 'built');

    const stdout = execFileSync(
      process.execPath,
      ['--require', preload, path.join(outdir, 'markout-cli.js'), 'build', docroot, written],
      { encoding: 'utf8', env: { ...process.env, MARKOUT_RUNTIME_BUNDLE: path.join(outdir, 'markout-runtime.js') } }
    );
    expect(stdout).toContain('1 page(s)');
    expect(fs.existsSync(path.join(written, 'index.html'))).toBe(true);
  }, 60000);

  it('is spawned as node rather than as an app', () => {
    // Electron only behaves as node when told to; without this it tries to
    // start an application around the script
    const src = fs.readFileSync(path.join(PACKAGE, 'src', 'preview.ts'), 'utf8');
    expect(src).toContain('ELECTRON_RUN_AS_NODE');
  });
});
