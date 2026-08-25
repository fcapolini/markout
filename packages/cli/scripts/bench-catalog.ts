// Perf harness for bench/markout-catalog: same app, three catalog sizes (300 / 1,020 /
// 10,020 rows, see gen-bench-pages.mjs), measuring mount/filter/sort/cart-update
// cost in a real browser. Run `node scripts/gen-bench-pages.mjs` first.
import path from 'node:path';
import { chromium } from 'playwright';
import { Server } from '../src/server';

const PAGES = [
  { path: 'markout-catalog/index.html', label: '300 rows' },
  { path: 'markout-catalog/bench-1000.html', label: '1,020 rows' },
  { path: 'markout-catalog/bench-10000.html', label: '10,020 rows' },
];

const REPEATS = 5; // plus one discarded warm-up run

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function toMarkdownTable(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

interface Timings {
  mount: number;
  filter: number;
  sort: number;
  cart: number;
}

// Plain JS source, evaluated in-page as a string rather than a transpiled
// function reference: tsx/esbuild's `__name` helper injection doesn't survive
// Playwright's function-to-string serialization, so this sidesteps it.
const MEASURE_SCRIPT = `(() => {
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
  const r = {};

  // mount every row at once: sizes row is [12, 24, 48, <full catalog>]
  const maxSizeChip = document.querySelectorAll('button.chip')[3];
  let t0 = performance.now();
  maxSizeChip.click();
  r.mount = performance.now() - t0;

  // filter the full mounted set down to a handful of matches
  const input = document.querySelector('input[type=search]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  t0 = performance.now();
  setter.call(input, 'Model0001');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  r.filter = performance.now() - t0;

  setter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));

  // re-sort the full set in place: keyed DOM moves, no create/destroy
  t0 = performance.now();
  byText('button.chip', 'Price up') && byText('button.chip', 'Price up').click();
  r.sort = performance.now() - t0;

  // 20 rapid, unbatched cart mutations (each touches 3 independent consumers)
  const buys = [...document.querySelectorAll('.card .buy')].slice(0, 20);
  t0 = performance.now();
  for (const b of buys) b.click();
  r.cart = performance.now() - t0;

  return r;
})()`;

async function measureOnce(page: import('playwright').Page): Promise<Timings> {
  return page.evaluate(MEASURE_SCRIPT) as Promise<Timings>;
}

async function main() {
  const server = await new Server({
    docroot: path.resolve(__dirname, '../bench'),
    port: 0,
    // warnings, not silence -- see the note in bench-compare.ts
    logger: (level, ...args) => level !== 'info' && console.log(`[server:${level}]`, ...args),
  }).start();

  let browser = await chromium.launch();
  const results: Record<string, Record<keyof Timings, number[]>> = {};
  const crashed: Record<string, boolean> = {};

  for (const { path: relPath, label } of PAGES) {
    results[label] = { mount: [], filter: [], sort: [], cart: [] };
    for (let i = 0; i <= REPEATS && !crashed[label]; i++) {
      const page = await browser.newPage();
      try {
        await page.goto(`http://127.0.0.1:${server.port}/${relPath}`);
        await page.waitForSelector('.card');
        const t = await measureOnce(page);
        if (i > 0) { // discard the first run as warm-up
          (Object.keys(t) as (keyof Timings)[]).forEach(k => results[label][k].push(t[k]));
        }
      } catch (err) {
        // a full-catalog mount can crash the renderer outright at large N --
        // that's itself a real data point, not a harness bug, so record it
        // and move on rather than retrying a guaranteed crash.
        console.log(`  ${label}: renderer crashed (${(err as Error).message.split('\n')[0]})`);
        crashed[label] = true;
      } finally {
        await page.close().catch(() => { /* page may already be gone if it crashed */ });
      }
    }
  }

  await browser.close();
  await server.stop();

  const headers = ['Rows', 'Mount all (ms)', 'Filter (ms)', 'Sort (ms)', '20x add-to-cart (ms)'];
  const rows = Object.entries(results).map(([label, m]) =>
    crashed[label]
      ? [label, 'CRASHED', '-', '-', '-']
      : [label, median(m.mount).toFixed(1), median(m.filter).toFixed(1), median(m.sort).toFixed(1), median(m.cart).toFixed(1)],
  );

  console.log(`\n${REPEATS} timed repeats per size (+1 discarded warm-up), median ms:\n`);
  console.log(toMarkdownTable(headers, rows));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
