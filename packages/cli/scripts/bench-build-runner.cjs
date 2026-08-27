// The stopwatch, in a process of its own, and the reason is one measurement.
//
// `execFileSync('node', ...)` does not exec `node` -- it searches PATH for it,
// and on macOS each candidate directory costs a few milliseconds to rule out.
// npm and npx each prepend `node_modules/.bin` entries to PATH, so the search
// gets longer the deeper inside a toolchain the caller sits. Medians of 8,
// M1 Pro, 2026-08-27:
//
//   caller                      'node' via PATH   process.execPath
//   a shell (22 PATH entries)        56ms              31ms
//   `npm run` (31 entries)          102ms              31ms
//
// So the harness was paying 25-70ms per spawn to look up a binary it already
// had the absolute path of. It is a near-constant, which is why it went
// unnoticed: noise against `next build` at eight seconds, and half of
// `markout build` at 150. It did not shift the table so much as tilt it, and
// only against the fastest row -- which is exactly the row Markout is in. The
// built row read 261ms while the same command from a shell took 155.
//
// `process.execPath` is the fix and is what everything here spawns with. It is
// also the more correct thing to say: it guarantees the node running the CLI
// is the node running the benchmark, which `'node'` never did.
//
// This file is still separate from `bench-build.ts`, for a smaller reason:
// that file runs under tsx, and PATH there is longer again. Keeping the
// stopwatch out of it keeps the measurement away from a variable that has
// nothing to do with any build. What remains is `baselineMs` below, reported
// rather than subtracted -- a benchmark that arithmetics its way to a better
// number is worse than one that discloses the residual and lets a reader
// subtract.
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** @param {number[]} nums */
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function time(fn) {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

/**
 * What a spawn costs here when the thing spawned does nothing.
 *
 * Reported with the results so the residual is visible rather than implied.
 * `node -e ''` and not `/usr/bin/true`: the floor that matters is the one for
 * starting a node, since every row in the table starts at least one.
 */
function spawnBaseline(repeats) {
  const runs = [];
  for (let i = 0; i <= repeats; i++) {
    const ms = time(() => execFileSync(process.execPath, ['-e', ''], { stdio: 'ignore' }));
    if (i) runs.push(ms);
  }
  return median(runs);
}

/** Every caching layer a build has; clearing is setup and stays outside the clock. */
function clean(dir, paths) {
  for (const p of paths) {
    fs.rmSync(path.join(dir, p), { recursive: true, force: true });
  }
}

/**
 * A job is one row: either an argv spawn (no shell, so a checkout under a
 * directory with a quote in its name is not reinterpreted) or a command run
 * through one, which is what `npm run` needs and what a developer types.
 */
function run(job, repeats) {
  const runs = [];
  for (let i = 0; i <= repeats; i++) {
    if (job.clean) clean(job.cwd, job.clean);
    const ms = time(() =>
      job.shell
        ? execSync(job.shell, { cwd: job.cwd, stdio: 'ignore' })
        : execFileSync(job.file, job.args, { cwd: job.cwd, stdio: 'ignore' })
    );
    if (i) runs.push(ms);
  }
  if (job.clean) clean(job.cwd, job.clean);
  return median(runs);
}

// The job list lives here rather than in `bench-build.ts` for the reason
// above: planning it there would mean this file were spawned from tsx.
const REPEATS = 5; // + 1 discarded warm-up, matching bench-build.ts
const CLI = path.resolve(__dirname, '../dist/cli.js');
const BENCH = path.resolve(__dirname, '../bench');
const PAGE = '/markout-catalog/index.html';
const OUTDIR = path.resolve(__dirname, '../.built-timing');
const CACHES = ['dist', '.next', 'node_modules/.vite', 'tsconfig.tsbuildinfo'];
const RESULTS = path.resolve(__dirname, '../.bench-build-results.json');
const PORTS = [
  { name: 'Alpine', dir: 'alpine-catalog' },
  { name: 'React', dir: 'react-catalog' },
  { name: 'Svelte', dir: 'svelte-catalog' },
  { name: 'Vue', dir: 'vue-catalog' },
  { name: 'Next', dir: 'next-catalog' },
];

if (!fs.existsSync(CLI)) {
  console.error(
    `no ${path.relative(process.cwd(), CLI)} -- run \`npm run build\` first, since Markout is ` +
      'timed through its CLI like every other port through theirs'
  );
  process.exit(1);
}

const jobs = [
  // argv rather than a command line: every one of these paths is derived from
  // `__dirname`, so a checkout under a directory with a quote or a `$(` in its
  // name would otherwise be handed to a shell to reinterpret. Nothing here
  // needs a shell, and not having one is the whole fix.
  {
    name: 'Markout (build)',
    cwd: path.resolve(__dirname, '..'),
    file: process.execPath,
    args: [CLI, 'build', BENCH, OUTDIR, '-p', PAGE],
    clean: [path.relative(path.resolve(__dirname, '..'), OUTDIR)],
  },
];
const skipped = [];
for (const { name, dir } of PORTS) {
  const cwd = path.join(BENCH, dir);
  if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
    skipped.push(`${name}: skipped (no node_modules -- \`npm install\` in bench/${dir})`);
    continue;
  }
  // A shell here, unlike the row above: `npm run build` is what a developer
  // types, and the string is a literal rather than anything path-derived.
  jobs.push({ name, cwd, shell: 'npm run build', clean: CACHES });
}

const out = { baselineMs: spawnBaseline(REPEATS), rows: {}, skipped };
for (const job of jobs) {
  out.rows[job.name] = run(job, REPEATS);
}
fs.rmSync(OUTDIR, { recursive: true, force: true });
fs.writeFileSync(RESULTS, JSON.stringify(out));
