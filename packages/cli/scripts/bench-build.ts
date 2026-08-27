// How long each port takes to turn its source into the artifact it ships.
//
// This is a cost a developer pays on every change, not one a visitor ever
// waits for, so it is measured on its own rather than folded into
// bench-compare.ts -- it needs no browser, no server, and no catalog size.
//
// Every port is timed at the same layer: the whole command, process startup
// included, because that is the wall clock a developer watches. `npm run`
// itself is nearly free here (measured against a direct `npx vite build`, it
// is the faster of the two), so the ports run their own build script
// unchanged -- the build a port ships with is part of what the port costs.
// React's includes `tsc -b`, which is most of its number; removing it to
// "make the comparison fair" would time a build nobody runs.
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { build } from '../src/server/build';

const REPEATS = 5; // + 1 discarded warm-up

const BENCH = path.resolve(__dirname, '../bench');
const CLI = path.resolve(__dirname, '../dist/cli.js');
// The app is one page. The scaled bench-*.html variants are excluded on
// purpose: they are the same source with a longer seed array, and building
// four copies of one app would compare Markout against four ports building
// one each.
const PAGE = '/markout-catalog/index.html';

const PORTS = [
  { name: 'Alpine', dir: 'alpine-catalog' },
  { name: 'React', dir: 'react-catalog' },
  { name: 'Svelte', dir: 'svelte-catalog' },
  { name: 'Vue', dir: 'vue-catalog' },
  // Optional, and skipped below when it has no node_modules: it is the only
  // port here whose install runs to hundreds of megabytes, and a build-time
  // run of the other four should not depend on having done it.
  { name: 'Next', dir: 'next-catalog' },
];

// Every caching layer a build has, cleared before each run. Vite's dep
// pre-bundling cache and tsc's incremental state both survive `rm -rf dist`,
// and a run that reuses them times the cache rather than the build.
function clean(dir: string) {
  // `.next` holds the output AND the build cache, so removing it is both
  // halves of what the other ports need two entries for. A run that keeps it
  // times an incremental rebuild, which is not what this table says it is.
  for (const p of ['dist', '.next', 'node_modules/.vite', 'tsconfig.tsbuildinfo']) {
    fs.rmSync(path.join(dir, p), { recursive: true, force: true });
  }
}

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function provenance(): string {
  const version = require('../package.json').version;
  let commit = 'unknown commit';
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain -- ../../cli ../../core', { cwd: __dirname, encoding: 'utf8' }).trim();
    commit = dirty ? `${head}+dirty` : head;
  } catch { /* not a checkout, or no git */ }
  return `Markout ${version} (${commit}), Node ${process.version}, ${process.platform}-${process.arch}`;
}

function time(fn: () => void): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

// The same compile the CLI run below performs, minus Node's startup and the
// CLI's own module graph -- which is exactly the served mode's situation: the
// process is already up and the compiler already loaded, so this is what the
// FIRST request for a page costs there. The express middleware caches the
// compiler's output per page and renders that per request, so every request
// after the first pays only the render (bench-compare.ts's `Server` column,
// which is warm and excludes this).
//
// It is not a like-for-like row against the four ports below: those are cold
// builds, and their warm equivalent would be a dev server's HMR update, which
// nothing here measures.
async function markoutCompileOnly(): Promise<number> {
  const outdir = path.resolve(__dirname, '../.built-timing');
  fs.rmSync(outdir, { recursive: true, force: true });
  const t = performance.now();
  const result = await build({ docroot: BENCH, outdir, pages: [PAGE], prerender: false });
  const ms = performance.now() - t;
  if (result.errors.length) {
    throw new Error(`markout build failed: ${result.errors.map((e) => e.msg ?? e).join('; ')}`);
  }
  fs.rmSync(outdir, { recursive: true, force: true });
  return ms;
}

async function main() {
  if (!fs.existsSync(CLI)) {
    throw new Error(`no ${path.relative(process.cwd(), CLI)} -- run \`npm run build\` first, since Markout is timed through its CLI like every other port through theirs`);
  }
  console.log(provenance());
  console.log(`Build time, median of ${REPEATS} (+1 discarded warm-up), caches cleared before every run\n`);

  const rows: string[][] = [];

  const outdir = path.resolve(__dirname, '../.built-timing');
  const markout: number[] = [];
  const compile: number[] = [];
  for (let i = 0; i <= REPEATS; i++) {
    fs.rmSync(outdir, { recursive: true, force: true }); // outside the clock: clearing is setup, not build
    // argv rather than a command line: every one of these paths is derived
    // from `__dirname`, so a checkout under a directory with a quote or a
    // `$(` in its name would otherwise be handed to a shell to reinterpret.
    // Nothing here needs a shell, and not having one is the whole fix.
    const ms = time(() => {
      execFileSync('node', [CLI, 'build', BENCH, outdir, '-p', PAGE], { stdio: 'ignore' });
    });
    const only = await markoutCompileOnly();
    if (i) { markout.push(ms); compile.push(only); }
  }
  fs.rmSync(outdir, { recursive: true, force: true });
  rows.push(['Markout (server)', median(compile).toFixed(0), 'compile, on the first request for a page']);
  rows.push(['Markout (build)', median(markout).toFixed(0), '`markout build`']);

  for (const { name, dir } of PORTS) {
    const cwd = path.join(BENCH, dir);
    if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
      console.log(`  ${name}: skipped (no node_modules -- \`npm install\` in bench/${dir})`);
      continue;
    }
    const runs: number[] = [];
    for (let i = 0; i <= REPEATS; i++) {
      clean(cwd); // outside the clock: clearing is setup, not build
      const ms = time(() => execSync('npm run build', { cwd, stdio: 'ignore' }));
      if (i) runs.push(ms);
    }
    const cmd = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts.build;
    rows.push([name, median(runs).toFixed(0), `\`${cmd}\``]);
  }

  const headers = ['Target', 'Build (ms)', 'What runs'];
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  console.log([line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
