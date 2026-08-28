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
//
// The stopwatch is NOT here. It is in ./bench-build-runner.cjs, which
// `bench:build` runs as its own step before this file, and the long version is
// in that file's header. Short version: `execFileSync('node', ...)` searches
// PATH for `node` rather than exec'ing it, npm and npx each prepend entries to
// PATH, and each entry costs a few milliseconds to rule out -- so the harness
// was paying 25-70ms per spawn to find a binary it had the absolute path of.
// `process.execPath` fixed it and this row moved from 261ms to 157ms, which is
// what the same command takes from a shell.
//
// This file reads what the runner left behind, adds the one row that needs the
// compiler in-process, and prints.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { build } from '@markout-lang/core';
import fs from 'node:fs';

const REPEATS = 5; // + 1 discarded warm-up

const BENCH = path.resolve(__dirname, '../bench');
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

const RESULTS = path.resolve(__dirname, '../.bench-build-results.json');

interface RunnerResult {
  /** what a spawn costs there when the thing spawned does nothing */
  baselineMs: number;
  rows: Record<string, number>;
  skipped: string[];
}

function readResults(): RunnerResult {
  if (!fs.existsSync(RESULTS)) {
    throw new Error(
      `no ${path.relative(process.cwd(), RESULTS)} -- run \`npm run bench:build\`, which runs ` +
        'scripts/bench-build-runner.cjs first; this file alone does no timing'
    );
  }
  const parsed = JSON.parse(fs.readFileSync(RESULTS, 'utf8')) as RunnerResult;
  // Consumed, not kept. Leaving it would let `tsx scripts/bench-build.ts` on
  // its own print a previous run's timings under this run's provenance line,
  // which is the one failure a benchmark must not have.
  fs.rmSync(RESULTS, { force: true });
  return parsed;
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

// The same compile the runner's `markout build` row performs, minus Node's
// startup and the CLI's own module graph -- which is exactly the served
// mode's situation: the
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
    throw new Error(`markout build failed: ${result.errors.map((e) => `${e.pathname}: ${e.error.msg}`).join('; ')}`);
  }
  fs.rmSync(outdir, { recursive: true, force: true });
  return ms;
}

async function main() {
  const timed = readResults();
  console.log(provenance());
  console.log(`Build time, median of ${REPEATS} (+1 discarded warm-up), caches cleared before every run\n`);

  const rows: string[][] = [];

  timed.skipped.forEach((s) => console.log(`  ${s}`));

  // The one row with no spawn in it: in-process, so there is nothing for a
  // stopwatch in another process to be further from, and it stays here where
  // the compiler is already loaded.
  const compile: number[] = [];
  for (let i = 0; i <= REPEATS; i++) {
    const only = await markoutCompileOnly();
    if (i) compile.push(only);
  }

  rows.push(['Markout (server)', median(compile).toFixed(0), 'compile, on the first request for a page']);
  rows.push(['Markout (build)', timed.rows['Markout (build)'].toFixed(0), '`markout build`']);
  for (const { name, dir } of PORTS) {
    if (!(name in timed.rows)) continue;
    const cmd = JSON.parse(
      fs.readFileSync(path.join(BENCH, dir, 'package.json'), 'utf8')
    ).scripts.build;
    rows.push([name, timed.rows[name].toFixed(0), `\`${cmd}\``]);
  }

  const headers = ['Target', 'Build (ms)', 'What runs'];
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  console.log([line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n'));
  // Disclosed rather than subtracted. Every spawned row carries it; the
  // in-process compile row does not, which is why it is named rather than
  // folded into any number.
  console.log(
    `\nSpawn baseline ${timed.baselineMs.toFixed(0)}ms -- what \`node -e ''\` costs from the runner, ` +
      'and a floor under every row above except Markout (server).'
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
