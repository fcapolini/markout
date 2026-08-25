// Combined perf comparison: Markout's bench/markout-catalog against
// hand-written, idiomatic Alpine 3, React, Svelte 5 and Vue 3.6 Vapor ports of
// the exact same app -- same components, same catalog generator (see
// bench/shared/catalog.mjs), same CSS, same interactions. One MEASURE_SCRIPT
// drives all five, which works because all five markups reuse the same class
// names on purpose; bench-catalog.ts uses the same script for Markout alone.
import { execSync, spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { chromium, Browser } from 'playwright';
import { gzipSync } from 'node:zlib';
import { Server } from '../src/server';

const ROWS = [300, 1020, 10020];
const REPEATS = 5; // + 1 discarded warm-up

const REACT_DIR = path.resolve(__dirname, '../bench/react-catalog');
const SVELTE_DIR = path.resolve(__dirname, '../bench/svelte-catalog');
const ALPINE_DIR = path.resolve(__dirname, '../bench/alpine-catalog');
const VUE_DIR = path.resolve(__dirname, '../bench/vue-catalog');
const REACT_PORT = 4410;
const SVELTE_PORT = 4411;
const ALPINE_PORT = 4412;
const VUE_PORT = 4413;

const MEASURE_SCRIPT = `(async () => {
  // An unstyled page lays out differently and would still produce numbers, so
  // a stylesheet that failed to load must fail the run rather than quietly
  // change what is being measured. Two directory renames have broken this link
  // already and neither showed up in the results. Checking document.styleSheets
  // does NOT catch it -- a 404'd <link> is still listed there, just with no
  // rules -- so this asserts the style APPLIED. All four ports share app.css,
  // whose body background is var(--mist); without it the body is transparent.
  if (getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)') {
    throw new Error('app.css did not apply -- check the page\\'s <link href>');
  }
  const byText = (sel, text) =>
    [...document.querySelectorAll(sel)].find(el => el.textContent && el.textContent.trim() === text);
  const cardCount = () => document.querySelectorAll('.card').length;
  // Alpine, React, Svelte and Vue all batch DOM updates onto a scheduler
  // tick after a click handler returns -- Markout happens to be synchronous,
  // but bracketing t0/t1 around .click() only measures "handler dispatched",
  // not "DOM updated", for the other four. Poll via rAF for the real,
  // comparable, user-perceived latency instead.
  const waitUntil = (cond, timeoutMs = 30000) => new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = () => {
      if (cond()) return resolve();
      if (performance.now() - start > timeoutMs) return reject(new Error('timed out waiting for condition'));
      requestAnimationFrame(tick);
    };
    tick();
  });
  const settle = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

  const r = {};

  const maxSizeChip = document.querySelectorAll('button.chip')[3];
  const targetCount = Number.parseInt(maxSizeChip.textContent, 10);
  let t0 = performance.now();
  maxSizeChip.click();
  await waitUntil(() => cardCount() === targetCount);
  r.mount = performance.now() - t0;

  const input = document.querySelector('input[type=search]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  t0 = performance.now();
  setter.call(input, 'Model0001');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitUntil(() => cardCount() !== targetCount);
  r.filter = performance.now() - t0;

  setter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitUntil(() => cardCount() === targetCount);

  t0 = performance.now();
  byText('button.chip', 'Price up') && byText('button.chip', 'Price up').click();
  await settle();
  r.sort = performance.now() - t0;

  const buys = [...document.querySelectorAll('.card .buy')].slice(0, 20);
  t0 = performance.now();
  for (const b of buys) b.click();
  await settle();
  r.cart = performance.now() - t0;

  return r;
})()`;

// Stamp what was measured onto the output. A whole release cycle of runtime
// work lands under one version, so the commit is the part that identifies a
// run -- and a table pasted somewhere without it cannot be re-checked later.
function provenance(): string {
  const version = require('../package.json').version;
  let commit = 'unknown commit';
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
    // The runtime, the harness and the bench apps all decide what a number
    // means, so any of them being uncommitted makes the run unreproducible.
    const dirty = execSync('git status --porcelain -- ../../cli ../../core', { cwd: __dirname, encoding: 'utf8' }).trim();
    commit = dirty ? `${head}+dirty` : head;
  } catch { /* not a checkout, or no git */ }
  return `Markout ${version} (${commit}), Node ${process.version}, ${process.platform}-${process.arch}`;
}

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function toMarkdownTable(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function waitForServer(url: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() - start > timeoutMs) reject(new Error(`timed out waiting for ${url}`));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function freePort(port: number) {
  try {
    execSync(`lsof -tiTCP:${port} -sTCP:LISTEN | xargs -r kill -9`, { stdio: 'ignore', shell: '/bin/bash' as any });
  } catch { /* nothing was listening */ }
}

async function startPreview(dir: string, port: number): Promise<ChildProcessWithoutNullStreams> {
  freePort(port); // a prior failed run's preview server can otherwise squat the port forever
  execSync('npm run build', { cwd: dir, stdio: 'ignore' });
  const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: dir });
  try {
    await waitForServer(`http://localhost:${port}/`); // vite preview binds ::1, not 127.0.0.1
  } catch (err) {
    proc.kill();
    throw err;
  }
  return proc;
}

interface Timings { mount: number; filter: number; sort: number; cart: number; }

async function measure(browser: Browser, url: string): Promise<Timings> {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForSelector('.card');
  const t = await page.evaluate(MEASURE_SCRIPT) as Timings;
  await page.close();
  return t;
}

interface Weight {
  html: number;   // uncompressed bytes of the document itself
  js: number;     // uncompressed bytes of every same-origin script
  css: number;    // uncompressed bytes of every same-origin stylesheet
  gzip: number;   // the three above, gzipped at a fixed level, summed
  heap: number;   // used JS heap after a forced GC, whole catalog mounted
  nodes: number;  // rendered DOM elements, <template> hosts excluded
  templates: number; // <template> hosts, which are a strategy artifact
  census: Record<string, number>; // body elements by tag.class, for parity
}

// What the page weighs, as opposed to what it costs to run. Two of these are
// the point and one is a check:
//
//   - Bytes are reported UNCOMPRESSED and separately gzipped here in Node at a
//     fixed level, rather than taken from transferSize. Whether a given server
//     happens to compress is a property of the server, not of the tool, and
//     Markout is served by its own Server while the other ports go through
//     `vite preview` -- reading transferSize would compare configurations.
//     Images are excluded: all four load the identical Unsplash URLs, and they
//     are the app's content rather than the tool's weight. The HTML/JS split
//     matters because Markout carries its app in the document where the other
//     three carry theirs in a bundle, so only the total is comparable.
//   - Heap is read after a forced GC with the whole catalog mounted. This is
//     where a per-row structure turns into megabytes, and no timing column
//     shows it.
//   - Node count and the tag.class census are PARITY CHECKS, not metrics. All
//     ports render the same DOM, so both must match across targets. The census
//     is the one that earns its keep: `class="catalog"` replacing the
//     definition's `class="panel"` changed no node count at all -- it was an
//     attribute, and counting elements would have sailed straight past it.
//     Comparing tag+class multisets catches that class of drift.
async function measureWeight(browser: Browser, url: string): Promise<Weight> {
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);
  try {
    await page.goto(url);
    await page.waitForSelector('.card');

    // Resource timing gives sizes and URLs; the fetch below gives us bytes we
    // can compress ourselves. Same-origin only, so a CDN image cannot leak in.
    const assets = await page.evaluate(`(() => {
      const origin = location.origin;
      const nav = performance.getEntriesByType('navigation')[0];
      const out = [{ url: location.href, kind: 'html', size: nav ? nav.decodedBodySize : 0 }];
      for (const e of performance.getEntriesByType('resource')) {
        if (!e.name.startsWith(origin)) continue;
        const kind = e.initiatorType === 'script' ? 'js'
          : (e.initiatorType === 'link' || e.initiatorType === 'css') ? 'css'
          : null;
        if (kind) out.push({ url: e.name, kind, size: e.decodedBodySize });
      }
      return out;
    })()`) as { url: string; kind: 'html' | 'js' | 'css'; size: number }[];

    const w: Weight = { html: 0, js: 0, css: 0, gzip: 0, heap: 0, nodes: 0, templates: 0, census: {} };
    for (const a of assets) {
      const body = Buffer.from(await (await fetch(a.url)).arrayBuffer());
      w[a.kind] += a.size || body.byteLength;
      w.gzip += gzipSync(body, { level: 6 }).byteLength;
    }

    // Mount the whole catalog before reading the heap -- 24 rows says nothing
    // about what a page costs to hold.
    await page.evaluate(`(async () => {
      const cardCount = () => document.querySelectorAll('.card').length;
      const chip = document.querySelectorAll('button.chip')[3];
      const target = Number.parseInt(chip.textContent, 10);
      chip.click();
      await new Promise((resolve, reject) => {
        const start = performance.now();
        const tick = () => {
          if (cardCount() === target) return resolve();
          if (performance.now() - start > 60000) return reject(new Error('timed out mounting'));
          requestAnimationFrame(tick);
        };
        tick();
      });
    })()`);

    // <template> is excluded on purpose. Alpine hosts every x-for on one and
    // Markout parks its stencils in <head>, so counting them would compare
    // rendering strategies; template CONTENT already sits in a fragment
    // outside the document, so this counts exactly what is rendered.
    const counts = await page.evaluate(`(() => ({
      all: document.getElementsByTagName('*').length,
      templates: document.getElementsByTagName('template').length,
    }))()`) as { all: number; templates: number };
    w.nodes = counts.all - counts.templates;
    w.templates = counts.templates;
    w.census = await page.evaluate(`(() => {
      const c = {};
      for (const el of document.body.getElementsByTagName('*')) {
        if (el.tagName === 'TEMPLATE' || el.tagName === 'SCRIPT') continue;
        const key = el.tagName + '.' + (el.getAttribute('class') || '');
        c[key] = (c[key] || 0) + 1;
      }
      return c;
    })()`) as Record<string, number>;
    await client.send('HeapProfiler.collectGarbage');
    const { usedSize } = await client.send('Runtime.getHeapUsage') as { usedSize: number };
    w.heap = usedSize;
    return w;
  } finally {
    await page.close().catch(() => { /* already gone */ });
  }
}

async function main() {
  // Warnings, not silence. A compile warning means the page is not the page
  // the author thinks it is -- `class` on a component usage REPLACING the
  // definition's own `class` cost this benchmark its Markout/React/Svelte/Alpine
  // parity for weeks, and the harness was passing `logger: () => {}` over the
  // top of the warning that said so. `info` is still dropped; it is one line
  // per request.
  const server = await new Server({
    docroot: path.resolve(__dirname, '../bench'),
    port: 0,
    logger: (level, ...args) => level !== 'info' && console.log(`[server:${level}]`, ...args),
  }).start();
  let reactProc: ChildProcessWithoutNullStreams | undefined;
  let svelteProc: ChildProcessWithoutNullStreams | undefined;
  let alpineProc: ChildProcessWithoutNullStreams | undefined;
  let vueProc: ChildProcessWithoutNullStreams | undefined;
  try {
    reactProc = await startPreview(REACT_DIR, REACT_PORT);
    svelteProc = await startPreview(SVELTE_DIR, SVELTE_PORT);
    alpineProc = await startPreview(ALPINE_DIR, ALPINE_PORT);
    vueProc = await startPreview(VUE_DIR, VUE_PORT);
    await run(server);
  } finally {
    reactProc?.kill();
    svelteProc?.kill();
    alpineProc?.kill();
    vueProc?.kill();
    await server.stop();
  }
}

async function run(server: Server) {
  const browser = await chromium.launch();

  const targets: { name: string; urlFor: (rows: number) => string }[] = [
    {
      name: 'Markout',
      urlFor: (rows) => {
        const file = rows === 300 ? 'index.html' : rows === 1020 ? 'bench-1000.html' : 'bench-10000.html';
        return `http://127.0.0.1:${server.port}/markout-catalog/${file}`;
      },
    },
    // Alpine second, right after Markout: it is the tool this audience is
    // actually choosing between, so it belongs next to the row it is read
    // against rather than at the bottom of the table.
    { name: 'Alpine', urlFor: (rows) => `http://localhost:${ALPINE_PORT}/?rows=${rows}` },
    { name: 'React', urlFor: (rows) => `http://localhost:${REACT_PORT}/?rows=${rows}` },
    { name: 'Svelte', urlFor: (rows) => `http://localhost:${SVELTE_PORT}/?rows=${rows}` },
    // Vue last, beside Svelte rather than beside React: this port is Vapor
    // mode, which compiles to direct DOM operations with no virtual DOM, so
    // it belongs next to the other compiled-no-VDOM entrant.
    { name: 'Vue', urlFor: (rows) => `http://localhost:${VUE_PORT}/?rows=${rows}` },
  ];

  const results: Record<string, Record<keyof Timings, number[]>> = {};
  const weights: Record<string, Weight | undefined> = {};
  const crashed: Record<string, boolean> = {};

  for (const rows of ROWS) {
    for (const target of targets) {
      const label = `${target.name} @ ${rows.toLocaleString()}`;
      results[label] = { mount: [], filter: [], sort: [], cart: [] };
      for (let i = 0; i <= REPEATS && !crashed[label]; i++) {
        try {
          const t = await measure(browser, target.urlFor(rows));
          if (i > 0) (Object.keys(t) as (keyof Timings)[]).forEach((k) => results[label][k].push(t[k]));
        } catch (err) {
          console.log(`  ${label}: failed (${(err as Error).message.split('\n')[0]})`);
          crashed[label] = true;
        }
      }
      // One pass, on its own page: weight is not a timing and does not want
      // repeats, and doing it here would perturb the runs above.
      if (!crashed[label]) {
        try {
          weights[label] = await measureWeight(browser, target.urlFor(rows));
        } catch (err) {
          console.log(`  ${label}: weight failed (${(err as Error).message.split('\n')[0]})`);
        }
      }
    }
  }

  const browserVersion = browser.version();
  await browser.close();

  const headers = ['Target', 'Mount all (ms)', 'Filter (ms)', 'Sort (ms)', '20x add-to-cart (ms)'];
  const rows = Object.entries(results).map(([label, m]) =>
    crashed[label]
      ? [label, 'FAILED', '-', '-', '-']
      : [label, median(m.mount).toFixed(1), median(m.filter).toFixed(1), median(m.sort).toFixed(1), median(m.cart).toFixed(1)],
  );

  console.log(`\n${provenance()}, Chromium ${browserVersion}`);
  console.log(`${REPEATS} timed repeats per size (+1 discarded warm-up), median ms:\n`);
  console.log(toMarkdownTable(headers, rows));

  const kb = (n: number) => (n / 1024).toFixed(1);
  const weightHeaders = ['Target', 'HTML (KB)', 'JS (KB)', 'CSS (KB)', 'Total gzip (KB)', 'Heap (MB)', 'DOM nodes'];
  const weightRows = Object.keys(results).map((label) => {
    const w = weights[label];
    return w
      ? [label, kb(w.html), kb(w.js), kb(w.css), kb(w.gzip), (w.heap / 1048576).toFixed(1),
         `${w.nodes.toLocaleString()} +${w.templates}t`]
      : [label, '-', '-', '-', '-', '-', '-'];
  });

  reportParity(targets.map((t) => t.name), weights);

  console.log('\nWeight, one pass per size. Bytes are uncompressed and gzipped here');
  console.log('rather than read off the wire, so the numbers are the tool\'s and not the');
  console.log('server\'s. Heap is after a forced GC with the whole catalog mounted.');
  console.log('DOM nodes is a parity check -- all five render the same markup, so the');
  console.log('counts must agree; +Nt is the <template> hosts each strategy needs, which');
  console.log('render nothing and are excluded from the count:\n');
  console.log(toMarkdownTable(weightHeaders, weightRows));
}

// Every port renders the same markup, so every port's tag+class census must be
// identical. Anything printed here is either a real drift between the ports or
// a known structural artifact of one of them -- and the two known ones are
// listed so a NEW line stands out instead of blending into expected noise.
function reportParity(names: string[], weights: Record<string, Weight | undefined>) {
  const sizes = [...new Set(Object.keys(weights).map((l) => l.split(' @ ')[1]))];
  const lines: string[] = [];
  for (const size of sizes) {
    const have = names
      .map((n) => [n, weights[`${n} @ ${size}`]] as const)
      .filter((e): e is readonly [string, Weight] => !!e[1]);
    if (have.length < 2) continue;
    const [, base] = have[0];
    const keys = [...new Set(have.flatMap(([, w]) => Object.keys(w.census)))].sort();
    for (const key of keys) {
      const counts = have.map(([n, w]) => [n, w.census[key] || 0] as const);
      if (counts.every(([, c]) => c === (base.census[key] || 0))) continue;
      lines.push(`  @ ${size}  ${key || '(no class)'}  ${counts.map(([n, c]) => `${n}=${c}`).join('  ')}`);
    }
  }
  console.log('\nDOM parity -- every port renders the same markup, so every tag+class count');
  console.log('must agree. Two differences are structural and expected: the other four');
  console.log('each need a wrapper <div> to mount into that Markout does not, and Markout');
  console.log('wraps slotted content, so <span class=tagline> holds one more <span>. A');
  console.log('line that is NOT one of those two is the ports drifting apart:\n');
  console.log(lines.length ? lines.join('\n') : '  (identical across all ports)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
