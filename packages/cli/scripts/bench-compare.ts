// Combined perf comparison: Markout's bench/markout-catalog, in both of the
// delivery modes an app like this would actually use, against hand-written,
// idiomatic Alpine 3, React, Svelte 5 and Vue 3.6 Vapor ports of the exact
// same app -- same components, same catalog generator (see
// bench/shared/catalog.mjs), same CSS, same interactions. One MEASURE_SCRIPT
// drives all six, which works because all six markups reuse the same class
// names on purpose; bench-catalog.ts uses the same script for Markout alone.
import { execSync, spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { chromium, Browser, Page } from 'playwright';
import { gzipSync } from 'node:zlib';
import { build } from '@markout-lang/core';
import { Server } from '../src/server';
import http from 'node:http';
import fs from 'node:fs';

const ROWS = [30, 300, 1020, 10020];
const REPEATS = 5; // + 1 discarded warm-up

const REACT_DIR = path.resolve(__dirname, '../bench/react-catalog');
const SVELTE_DIR = path.resolve(__dirname, '../bench/svelte-catalog');
const ALPINE_DIR = path.resolve(__dirname, '../bench/alpine-catalog');
const VUE_DIR = path.resolve(__dirname, '../bench/vue-catalog');
const NEXT_DIR = path.resolve(__dirname, '../bench/next-catalog');
const REACT_PORT = 4410;
const SVELTE_PORT = 4411;
const ALPINE_PORT = 4412;
const VUE_PORT = 4413;
const MARKOUT_BUILD_PORT = 4414;
const NEXT_PORT = 4415;

// One place that says which generated page is which size, since three things
// need to agree about it: the served target, the built target, and the list of
// pages handed to `build`.
const PAGE_FOR_ROWS: Record<number, string> = {
  30: 'bench-30.html',
  300: 'index.html',
  1020: 'bench-1000.html',
  10020: 'bench-10000.html',
};

const MEASURE_SCRIPT = `(async () => {
  // An unstyled page lays out differently and would still produce numbers, so
  // a stylesheet that failed to load must fail the run rather than quietly
  // change what is being measured. Two directory renames have broken this link
  // already and neither showed up in the results. Checking document.styleSheets
  // does NOT catch it -- a 404'd <link> is still listed there, just with no
  // rules -- so this asserts the style APPLIED. Every port shares app.css,
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
  // not "DOM updated", for the others. Poll via rAF for the real,
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
  // 'Model0001 Ash' rather than 'Model0001': at the 30-row size the catalog
  // has exactly one model, so the shorter term matches every row, the count
  // never changes and the wait never returns. This one leaves 6 rows standing
  // at EVERY size, which is the constant the filter column wants -- the number
  // destroyed scales with the catalog, the number surviving does not.
  setter.call(input, 'Model0001 Ash');
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

// Next is not a `vite preview`, so it gets its own launcher rather than a
// branch inside that one. `next build` then `next start`, never `next dev`:
// dev mode compiles on request and would time the compiler.
//
// The port is OPTIONAL. It is the only one here whose dependency tree runs to
// hundreds of megabytes, and a run of the other five should not be blocked on
// having installed it, so an uninstalled next-catalog is skipped with a note
// rather than failing the run.
function nextInstalled(): boolean {
  return fs.existsSync(path.join(NEXT_DIR, 'node_modules/next'));
}

async function startNext(dir: string, port: number): Promise<ChildProcessWithoutNullStreams> {
  freePort(port);
  execSync('npm run build', { cwd: dir, stdio: 'ignore' });
  const proc = spawn('npx', ['next', 'start', '--port', String(port)], { cwd: dir });
  try {
    await waitForServer(`http://localhost:${port}/`);
  } catch (err) {
    proc.kill();
    throw err;
  }
  return proc;
}

interface Timings { mount: number; filter: number; sort: number; cart: number; }

/**
 * A row in every table, and the two expressions a server-rendered row needs.
 *
 * `ready` is a HANDSHAKE and it exists because of one asymmetry. On the four
 * SPA ports nothing is in the document until their bundle has run, so
 * `waitForSelector('.card')` proves two things at once: the content is there,
 * and the framework that made it is running. A server-rendered page breaks
 * that identity -- its buttons are in the markup that arrived over the wire,
 * complete and inert, before React has attached a single listener. Clicking
 * one then does nothing at all, and `waitUntil(cardCount === target)` spins
 * until it throws. That failure is loud, which is lucky; the quiet version is
 * a harness "fixed" with a fixed sleep, which silently folds however long
 * hydration took into the mount column.
 *
 * So a server-rendered target declares a boolean expression that is true only
 * once its handlers are live, and NOTHING is timed until it holds.
 *
 * `interactiveAt` is the same fact turned into a number, because it deserves
 * to be reported rather than merely waited for: a page that arrives rendered
 * wins the first-card column, and the gap between arriving and answering a
 * click is what that win costs. A target that omits it is one whose content
 * is built by its own JavaScript, where the two instants are the same by
 * construction and first card already reports it.
 */
interface Target {
  name: string;
  urlFor: (rows: number) => string;
  /** boolean expression; nothing is timed until it holds */
  ready?: string;
  /** expression returning ms since navigation start; defaults to first card */
  interactiveAt?: string;
}

// 30s, matching the in-page waits. A port that has not hydrated by then has
// not hydrated, and reporting that is more useful than blocking the run.
async function awaitReady(page: Page, ready?: string) {
  if (!ready) return;
  await page.waitForFunction(ready, null, { timeout: 30000 });
}

async function measure(browser: Browser, url: string, ready?: string): Promise<Timings> {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForSelector('.card');
  await awaitReady(page, ready);
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
  texts: Record<string, string>;  // key rendered strings, also for parity
}

// What the page weighs, as opposed to what it costs to run. Two of these are
// the point and one is a check:
//
//   - Bytes are reported UNCOMPRESSED and separately gzipped here in Node at a
//     fixed level, rather than taken from transferSize. Whether a given server
//     happens to compress is a property of the server, not of the tool, and
//     Markout is served by its own Server while the other ports go through
//     `vite preview` -- reading transferSize would compare configurations.
//     Images are excluded: every port loads the identical Unsplash URLs, and they
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
async function measureWeight(browser: Browser, url: string, ready?: string): Promise<Weight> {
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);
  try {
    await page.goto(url);
    await page.waitForSelector('.card');
    // The heap reading below mounts the whole catalog by clicking, so this
    // needs the same handshake the timed runs do -- on a server-rendered page
    // the chip exists long before it does anything.
    await awaitReady(page, ready);

    // Resource timing gives sizes and URLs; the fetch below gives us bytes we
    // can compress ourselves. Same-origin only, so a CDN image cannot leak in.
    const assets = await page.evaluate(`(() => {
      const origin = location.origin;
      const nav = performance.getEntriesByType('navigation')[0];
      const out = [{ url: location.href, kind: 'html', size: nav ? nav.decodedBodySize : 0 }];
      for (const e of performance.getEntriesByType('resource')) {
        if (!e.name.startsWith(origin)) continue;
        // The EXTENSION decides, and initiatorType only breaks ties. A
        // <link rel=preload as=script> reports initiatorType 'link', so
        // classifying on that alone files a preloaded bundle under CSS --
        // which is exactly what Next's webpack chunk did, 3.3KB of
        // JavaScript sitting in the stylesheet column. The four Vite ports
        // never caught it because none of them preloads anything.
        const path = e.name.split('?')[0];
        const kind = /\.css$/.test(path) ? 'css'
          : /\.m?js$/.test(path) ? 'js'
          : e.initiatorType === 'script' ? 'js'
          : (e.initiatorType === 'link' || e.initiatorType === 'css') ? 'css'
          : null;
        if (kind) out.push({ url: e.name, kind, size: e.decodedBodySize });
      }
      return out;
    })()`) as { url: string; kind: 'html' | 'js' | 'css'; size: number }[];

    const w: Weight = { html: 0, js: 0, css: 0, gzip: 0, heap: 0, nodes: 0, templates: 0, census: {}, texts: {} };
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
    // outside the document, so nothing rendered is lost by skipping them.
    w.templates = await page.evaluate(
      'document.getElementsByTagName("template").length',
    ) as number;
    w.census = await page.evaluate(`(() => {
      const c = {};
      for (const el of document.body.getElementsByTagName('*')) {
        if (el.tagName === 'TEMPLATE' || el.tagName === 'SCRIPT') continue;
        const key = el.tagName + '.' + (el.getAttribute('class') || '');
        c[key] = (c[key] || 0) + 1;
      }
      return c;
    })()`) as Record<string, number>;
    // Exactly what the census counts, so the two can never disagree: body
    // elements, no <template>, no <script>. Counting <script> put the two
    // Markout modes one apart -- a built page carries one more than a served
    // one -- for a difference that is not rendered content at all.
    w.nodes = Object.values(w.census).reduce((n, c) => n + c, 0);

    // Structure parity is not output parity. Markout's average-price stat once
    // read $105 where the other ports read $106 -- it truncated with `| 0`
    // where the others rounded -- and every tag and class matched perfectly
    // while the page said something different. So compare what a few known
    // elements actually SAY, not just that they exist.
    //
    // The reason recorded here for that `| 0` was wrong and is worth
    // correcting rather than deleting: `${...}` reaches `Math` perfectly well,
    // and always could. `Math` is on GLOBAL_NAMES in core's core-global.ts,
    // which exists precisely so the JS standard library is available to an
    // expression, and the port has used `Math.round` since the drift was
    // fixed. A name that is genuinely not in scope is a compile ERROR --
    // `Unknown reference: "..."`, with the line and column -- so the silent
    // failure this comment warned about was never the one it named. The check
    // below still earns its place: two ports can agree on every tag and class
    // and disagree on what they render, whatever the cause.
    w.texts = await page.evaluate(`(() => {
      const t = (sel) => (document.querySelector(sel) || {}).textContent || '(absent)';
      const out = {};
      [...document.querySelectorAll('.stat-value')].forEach((e, i) => { out['stat' + i] = e.textContent; });
      out.pager = (t('.pager-label') || '').trim();
      out.hits = t('.search-hits');
      out.cardTitle = t('.card-title');
      out.cardBrand = t('.card-brand');
      out.cardPrice = t('.card-price');
      out.cardStock = t('.card-stock');
      out.starsOn = String(document.querySelectorAll('.card .star-on').length);
      return out;
    })()`) as Record<string, string>;
    await client.send('HeapProfiler.collectGarbage');
    const { usedSize } = await client.send('Runtime.getHeapUsage') as { usedSize: number };
    w.heap = usedSize;
    return w;
  } finally {
    await page.close().catch(() => { /* already gone */ });
  }
}

interface FirstPaint {
  fcp: number;         // first contentful paint, ms
  firstCard: number;   // first .card in the DOM, ms from navigation start
  interactive: number; // ms from navigation start until a click would work
  noJsCards: number;   // .card elements present with JavaScript disabled
}

// A 1x1 transparent PNG standing in for the six Unsplash photos. The CSS sizes
// every card image with `aspect-ratio: 1.4; width: 100%`, so intrinsic size is
// irrelevant and layout is byte-for-byte what it was -- but the CDN is out of
// the measurement, which matters because a paint metric taken over the public
// internet measures Unsplash rather than the tool.
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// When content appears, as opposed to how fast it updates once it is there.
//
// This is a DELIVERY comparison and has to be read as one. Markout's page is
// rendered by its own Server, so it arrives with its first rows already in the
// markup; the client-rendering ports serve an empty shell and build everything after
// their bundle runs. React and Vue can render on the server and these ports do
// not -- that is each tool's DEFAULT setup, not its ceiling. Alpine is the only
// one with no server story of its own to reach for.
//
// noJsCards is the same fact without a stopwatch: load the page with JavaScript
// turned off and count what is on it. A <template> is inert, so Alpine's markup
// counts zero, which is correct -- nothing is rendered.
//
// FCP is reported because people know it, and DISTRUSTED because on these pages
// it is close to meaningless. It fires on the first contentful paint of
// anything, and every port has a static header; Alpine posts the fastest FCP on
// this page while rendering none of the catalog, which is the x-cloak gap
// flattering itself. `firstCard` is the metric with the meaning: when the first
// row of actual content exists. Quote that one.
async function measureFirstPaint(
  browser: Browser,
  url: string,
  ready?: string,
  interactiveAt?: string,
): Promise<FirstPaint> {
  const ctx = await browser.newContext();
  await ctx.route('**://images.unsplash.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG }),
  );
  const page = await ctx.newPage();
  // LCP keeps being revised until interaction or hide, so record every entry
  // and read the last one once content has settled.
  // MutationObserver rather than a rAF poll: a served-rendered page has its
  // cards before the first frame, and a 16ms polling granularity would round
  // exactly the difference this column exists to show.
  await page.addInitScript(`
    window.__firstCard = null;
    const stamp = () => {
      if (window.__firstCard === null && document.querySelector('.card')) {
        window.__firstCard = performance.now();
        return true;
      }
      return window.__firstCard !== null;
    };
    if (!stamp()) {
      const obs = new MutationObserver(() => { if (stamp()) obs.disconnect(); });
      obs.observe(document, { childList: true, subtree: true });
    }
  `);
  let fcp = 0;
  let firstCard = 0;
  let interactive = 0;
  try {
    await page.goto(url);
    await page.waitForSelector('.card');
    await awaitReady(page, ready);
    await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const paints = await page.evaluate(`(() => {
      const p = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint');
      return { fcp: p ? p.startTime : 0, firstCard: window.__firstCard || 0 };
    })()`) as { fcp: number; firstCard: number };
    fcp = paints.fcp;
    firstCard = paints.firstCard;
    // A target with no expression of its own builds its content with its own
    // JavaScript, so the content existing IS the handlers existing and first
    // card already reported this. Only a page that arrives rendered has two
    // different instants to tell apart.
    interactive = interactiveAt
      ? await page.evaluate(interactiveAt) as number
      : firstCard;
  } finally {
    await ctx.close();
  }

  const noJs = await browser.newContext({ javaScriptEnabled: false });
  await noJs.route('**://images.unsplash.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG }),
  );
  let noJsCards = 0;
  try {
    const p2 = await noJs.newPage();
    await p2.goto(url);
    noJsCards = await p2.evaluate('document.querySelectorAll(".card").length') as number;
  } finally {
    await noJs.close();
  }

  return { fcp, firstCard, interactive, noJsCards };
}

// Markout in its OTHER ahead-of-time mode. `markout build` compiles and stops:
// values resolve in the browser, so this artifact is the same shape as the
// four SPA ports and is the row that compares like for like with them. The
// served mode above is the other realistic deployment for an app like this.
//
// `markout prerender` is deliberately not measured. It is the right mode for a
// documentation site, whose content is genuinely fixed at build time; a
// catalog's rows are the kind of thing that changes without a redeploy, and
// freezing them into the artifact is not what anyone would ship.
/**
 * The stylesheet the restricted build does not copy.
 *
 * `pages` restricts the build, which skips the asset copy -- so this is
 * carried across by hand, and it is named rather than written twice because
 * the server below has to know it is one of the files it serves. Leading
 * slash, like everything else the build reports and everything a request
 * asks for -- a key that did not match would be a 404 nobody looked for.
 */
const CATALOG_CSS = '/markout-catalog/app.css';

async function buildMarkoutClientMode(): Promise<{ dir: string; stop: () => void; port: number }> {
  const docroot = path.resolve(__dirname, '../bench');
  // beside bench/, not inside it: build refuses an outdir under the docroot,
  // because the next run would compile its own output
  const dir = path.resolve(__dirname, '../.built-catalog');
  fs.rmSync(dir, { recursive: true, force: true });
  const pages = Object.values(PAGE_FOR_ROWS).map((f) => `/markout-catalog/${f}`);
  const result = await build({ docroot, outdir: dir, pages, prerender: false });
  if (result.errors.length) {
    throw new Error(`markout build failed: ${result.errors.map(e => `${e.pathname}: ${e.error.msg}`).join('; ')}`);
  }
  // `pages` restricts the build, which also skips the asset copy -- and the
  // measure script refuses a page whose stylesheet did not apply, correctly.
  fs.copyFileSync(
    path.join(docroot, ...CATALOG_CSS.split('/')),
    path.join(dir, ...CATALOG_CSS.split('/')),
  );

  /**
   * What this server will serve, by the pathname it answers at.
   *
   * The build has just told us every file it wrote, so a request is a LOOKUP
   * and never a path: `/../../../../etc/passwd` is a key nothing has, which
   * is a 404 and not a rule that had to be got right.
   *
   * That is the difference from guarding the traversal, which is what this
   * did before. A guard is a claim about every input; a map is a claim about
   * the output, and this server exists to serve exactly one build's output.
   * It also means CodeQL has nothing to flag rather than a sanitiser it
   * cannot see through -- but the reason to do it is that it is the smaller
   * thing to be right about.
   */
  const served = new Map<string, string>();
  for (const pathname of [...result.pages, result.runtime, CATALOG_CSS]) {
    served.set(pathname, path.join(dir, ...pathname.split('/')));
  }

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = served.get(rel);
    if (!file) {
      res.statusCode = 404;
      res.end();
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) { res.statusCode = 404; res.end(); return; }
      const type = file.endsWith('.css') ? 'text/css'
        : file.endsWith('.js') ? 'text/javascript'
        : 'text/html';
      res.setHeader('content-type', type);
      res.end(body);
    });
  });
  freePort(MARKOUT_BUILD_PORT);
  await new Promise<void>((resolve) => server.listen(MARKOUT_BUILD_PORT, resolve));
  return { dir, port: MARKOUT_BUILD_PORT, stop: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
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
  let nextProc: ChildProcessWithoutNullStreams | undefined;
  let markoutBuild: { dir: string; stop: () => void; port: number } | undefined;
  try {
    reactProc = await startPreview(REACT_DIR, REACT_PORT);
    svelteProc = await startPreview(SVELTE_DIR, SVELTE_PORT);
    alpineProc = await startPreview(ALPINE_DIR, ALPINE_PORT);
    vueProc = await startPreview(VUE_DIR, VUE_PORT);
    const withNext = nextInstalled();
    if (withNext) nextProc = await startNext(NEXT_DIR, NEXT_PORT);
    else console.log('  Next: skipped (no node_modules -- `npm install` in bench/next-catalog)');
    markoutBuild = await buildMarkoutClientMode();
    await run(server, withNext);
  } finally {
    reactProc?.kill();
    svelteProc?.kill();
    alpineProc?.kill();
    vueProc?.kill();
    nextProc?.kill();
    markoutBuild?.stop();
    await server.stop();
  }
}

async function run(server: Server, withNext: boolean) {
  const browser = await chromium.launch();

  const targets: Target[] = [
    // The two deployments an app like this would actually have. `server` puts
    // Node in the request path and the page arrives rendered; `build` ships a
    // compiled artifact that resolves in the browser, like the four below it.
    {
      name: 'Markout (server)',
      urlFor: (rows) => `http://127.0.0.1:${server.port}/markout-catalog/${PAGE_FOR_ROWS[rows]}`,
      // No `ready` gate: the runtime's autoInit runs inside the
      // DOMContentLoaded handler and mounts synchronously, and Playwright's
      // goto has already waited past load by the time anything is clicked.
      // That same fact is what makes the stamp below the honest one --
      // domContentLoadedEventEnd is timestamped after every DCL handler has
      // returned, so on this page it is exactly when the page went live.
      interactiveAt: `performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd`,
    },
    {
      name: 'Markout (build)',
      urlFor: (rows) => `http://127.0.0.1:${MARKOUT_BUILD_PORT}/markout-catalog/${PAGE_FOR_ROWS[rows]}`,
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
    // Next last, and read against 'Markout (server)' rather than against the
    // four above it: it is the only other row here that renders on the server
    // and ships the result. Its INTERACTION columns are React's columns plus
    // whatever the App Router adds -- the React row already answers "how fast
    // is this runtime", and this row does not answer it a second time. What it
    // answers is what a retrofitted server story costs: the interactive gap,
    // the payload in the document, and the build.
    ...(withNext
      ? [{
          name: 'Next',
          urlFor: (rows: number) => `http://localhost:${NEXT_PORT}/?rows=${rows}`,
          ready: 'window.__ready !== undefined',
          interactiveAt: 'window.__ready',
        }]
      : []),
  ];

  const results: Record<string, Record<keyof Timings, number[]>> = {};
  const weights: Record<string, Weight | undefined> = {};
  const paints: Record<string, FirstPaint | undefined> = {};
  const crashed: Record<string, boolean> = {};

  for (const rows of ROWS) {
    for (const target of targets) {
      const label = `${target.name} @ ${rows.toLocaleString()}`;
      results[label] = { mount: [], filter: [], sort: [], cart: [] };
      for (let i = 0; i <= REPEATS && !crashed[label]; i++) {
        try {
          const t = await measure(browser, target.urlFor(rows), target.ready);
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
          weights[label] = await measureWeight(browser, target.urlFor(rows), target.ready);
        } catch (err) {
          console.log(`  ${label}: weight failed (${(err as Error).message.split('\n')[0]})`);
        }
        try {
          paints[label] = await measureFirstPaint(
            browser, target.urlFor(rows), target.ready, target.interactiveAt);
        } catch (err) {
          console.log(`  ${label}: first paint failed (${(err as Error).message.split('\n')[0]})`);
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

  const paintHeaders = ['Target', 'First card (ms)', 'Interactive (ms)', 'Cards without JS', 'FCP (ms)'];
  const paintRows = Object.keys(results).map((label) => {
    const fp = paints[label];
    return fp
      ? [label, fp.firstCard.toFixed(1), fp.interactive.toFixed(1), String(fp.noJsCards), fp.fcp.toFixed(1)]
      : [label, '-', '-', '-', '-'];
  });
  console.log('\nFirst content. Unsplash is stubbed with a 1x1 PNG so this measures the');
  console.log('tool and not a CDN; the CSS sizes every card image, so layout is unchanged.');
  console.log('This is a DELIVERY comparison, not a rendering one, which is why Markout');
  console.log('is here twice. Served, it arrives with its rows already in the markup.');
  console.log('Built, it ships a compiled artifact that fills itself in -- the same shape');
  console.log('as the four SPA ports, and the row to read against them. `prerender` is');
  console.log('not measured: it suits a documentation site, not a catalog whose rows');
  console.log('change without a redeploy. React and Vue CAN render on the server and');
  console.log('these ports do not -- their default setup, not their ceiling; Alpine is');
  console.log('the one with no server story of its own to reach for.\n');
  console.log('Interactive is the column that keeps first card honest. A page that arrives');
  console.log('rendered shows content before it can answer a click, and the gap between the');
  console.log('two is what that delivery costs. For a port that BUILDS its content in the');
  console.log('browser the two instants are the same by construction, so its two columns');
  console.log('agree -- that is not a tie, it is the same measurement twice.\n');
  console.log('FCP is last and least: it fires on the first paint of ANYTHING, and every');
  console.log('port has a static header, so a page that paints chrome before it has any');
  console.log('content scores well on it. First card is the column with the meaning.\n');
  console.log(toMarkdownTable(paintHeaders, paintRows));

  reportParity(targets.map((t) => t.name), weights);

  console.log('\nWeight, one pass per size. Bytes are uncompressed and gzipped here');
  console.log('rather than read off the wire, so the numbers are the tool\'s and not the');
  console.log('server\'s. Heap is after a forced GC with the whole catalog mounted.');
  console.log('DOM nodes is a parity check -- every port renders the same markup, so the');
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
    const textKeys = [...new Set(have.flatMap(([, w]) => Object.keys(w.texts)))].sort();
    for (const key of textKeys) {
      const vals = have.map(([n, w]) => [n, w.texts[key] ?? '(absent)'] as const);
      if (vals.every(([, v]) => v === (base.texts[key] ?? '(absent)'))) continue;
      lines.push(`  @ ${size}  text:${key}  ${vals.map(([n, v]) => `${n}="${v}"`).join('  ')}`);
    }
  }
  console.log('\nDOM parity -- every port renders the same markup, so every tag+class count');
  console.log('must agree. Two differences are structural and expected: the other ports');
  console.log('each need a wrapper <div> to mount into that Markout does not, and Markout');
  console.log('wraps slotted content, so <span class=tagline> holds one more <span>. A');
  console.log('line that is NOT one of those two is the ports drifting apart. text: lines');
  console.log('compare what known elements SAY, because matching structure is not matching');
  console.log('output -- one port rendering $105 where the rest render $106 passes every');
  console.log('tag and class check ever written:\n');
  console.log(lines.length ? lines.join('\n') : '  (identical across all ports)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
