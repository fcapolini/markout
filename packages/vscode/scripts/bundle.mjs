/**
 * What actually ships: two files, with everything they need inside them.
 *
 * A `.vsix` is unzipped somewhere with no `npm install` behind it, so an
 * extension's `require`s have to resolve from what is in the archive. This
 * package's biggest dependency is `@markout-lang/core`, a WORKSPACE package --
 * resolved here through a symlink node_modules that does not travel -- so an
 * unbundled build works in the development host, which runs from the repo,
 * and fails the moment it is installed. That is the whole reason to bundle,
 * and the reason `npm run package` builds before it packages.
 *
 * `tsc` still runs, and still checks everything; its output goes to `out/`
 * and is thrown away. esbuild does not type-check, and a build that only
 * bundles is a build that ships whatever it managed to parse.
 */
import { build, context } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const require = createRequire(import.meta.url);
const cliVersion = JSON.parse(
  fs.readFileSync(path.join(pkg, '../cli/package.json'), 'utf8')
).version;

/** where to write; `dist` unless a caller wants a copy of its own to inspect */
const flag = process.argv.indexOf('--outdir');
const outdir = flag < 0 ? path.join(pkg, 'dist') : path.resolve(process.argv[flag + 1]);
const quiet = process.argv.includes('--quiet');
/** rebuild on every save, for the development host to pick up on reload */
const watch = process.argv.includes('--watch');

/**
 * What the editor loads, and what it spawns.
 *
 * The third is not loaded by anything: `markout-cli.js` is the `markout`
 * command, bundled so the extension can SPAWN it with `process.execPath` --
 * the editor's own node, which needs no PATH and no npm, and is therefore the
 * one way to serve a preview for an audience that has neither. It carries
 * express and commander, which is exactly why it is a separate file and a
 * separate process: the rule the monorepo split exists to keep is that the
 * editor's process runs no web server, and a child process is not that
 * process. See docs/design/without-node.md.
 */
const ENTRIES = [
  { in: 'src/client.ts', out: 'client.js' },
  { in: 'src/server.ts', out: 'server.js' },
  { in: '../cli/src/cli.ts', out: 'markout-cli.js' },
];

for (const entry of ENTRIES) {
  const options = {
    entryPoints: [path.join(pkg, entry.in)],
    outfile: path.join(outdir, entry.out),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // what VS Code 1.90 runs extensions on
    target: 'node18',
    // `vscode` is not a module, it is the host: it exists only inside the
    // extension host and must never be bundled
    external: ['vscode'],
    /**
     * ESM builds first, and this is not a preference.
     *
     * `vscode-html-languageservice` ships UMD as its `main`, and a UMD
     * wrapper passes `require` into its factory as an ARGUMENT. A shadowed
     * `require` is one esbuild cannot follow, so it leaves the call standing
     * -- and `require("./parser/htmlScanner")` then resolves against the
     * directory the bundle is in, where there is no such file. It builds
     * clean and dies on the first line of work. Its `module` build is plain
     * ESM with static imports, which bundles.
     */
    mainFields: ['module', 'main'],
    // Volar reaches for it when a project is a TypeScript one, and this
    // server deliberately is not -- see createSimpleProject in server.ts.
    // Bundled it would be 8MB of compiler nobody here calls.
    ...(entry.in.endsWith('server.ts') ? { external: ['vscode', 'typescript'] } : {}),
    // the sidecar is a plain node program, spawned rather than loaded: it
    // never sees the extension host, so `vscode` is not external to it -- it
    // is not there at all. A banner marks it, since a bundle in `dist/` next
    // to two the editor DOES load is worth being unambiguous about.
    ...(entry.out === 'markout-cli.js'
      ? {
          external: [],
          // its own version, not the extension's: `../package.json` from
          // `dist/` is this package's, and a sidecar reporting the
          // extension's version would be lying about which markout ran
          define: {
            'process.env.MARKOUT_CLI_VERSION': JSON.stringify(cliVersion),
          },
          banner: { js: '// markout CLI, bundled as a sidecar: spawned, never required.' },
        }
      : {}),
    logLevel: 'warning',
    metafile: true,
    // for breakpoints in src/ to bind in the development host. Kept out of
    // the archive by .vscodeignore: the map is bigger than the bundle
    sourcemap: true,
  };
  if (watch) {
    await (await context(options)).watch();
    console.log(`watching ${entry.in}`);
    continue;
  }
  const result = await build(options);
  // the outputs include the sourcemap, which is the bigger of the two and
  // not the one being reported
  const [, output] = Object.entries(result.metafile.outputs).find(([file]) =>
    file.endsWith(entry.out)
  );
  const bytes = output.bytes;
  if (!quiet) {
    console.log(`${path.relative(pkg, path.join(outdir, entry.out))}  ${(bytes / 1024).toFixed(0)} KB`);
  }
}

/**
 * The browser runtime, copied in beside the bundles.
 *
 * Core finds it by walking two levels up from its own directory, which is
 * true of an installed package and false of one bundled into an extension --
 * so a copy travels in the archive and `MARKOUT_RUNTIME_BUNDLE` points at it
 * (set for this process in client.ts, and for the sidecar's when it is
 * spawned). Without this the preview serves pages that never come alive and
 * the build refuses to write, both of which read as the language being
 * broken rather than as a file being in the wrong place.
 */
const runtime = path.join(
  path.dirname(require.resolve('@markout-lang/core/package.json')),
  'dist',
  'markout-runtime.js'
);
fs.copyFileSync(runtime, path.join(outdir, 'markout-runtime.js'));
if (!quiet) {
  console.log(
    `${path.relative(pkg, path.join(outdir, 'markout-runtime.js'))}  ` +
      `${(fs.statSync(runtime).size / 1024).toFixed(0)} KB`
  );
}
