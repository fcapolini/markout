// Combined perf comparison: Markout's demo/medium vs hand-written, idiomatic
// React and Svelte 5 ports of the exact same app (same components, same
// catalog generator -- see bench/shared/catalog.mjs -- same CSS, same
// interactions). Same MEASURE_SCRIPT as bench-medium.ts, run against all
// three, since all three markups reuse the same class names on purpose.
import { execSync, spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { chromium, Browser } from 'playwright';
import { Server } from '../src/server';

const ROWS = [300, 1020, 10020];
const REPEATS = 5; // + 1 discarded warm-up

const REACT_DIR = path.resolve(__dirname, '../bench/react-medium');
const SVELTE_DIR = path.resolve(__dirname, '../bench/svelte-medium');
const REACT_PORT = 4410;
const SVELTE_PORT = 4411;

const MEASURE_SCRIPT = `(async () => {
  const byText = (sel, text) =>
    [...document.querySelectorAll(sel)].find(el => el.textContent && el.textContent.trim() === text);
  const cardCount = () => document.querySelectorAll('.card').length;
  // React/Svelte batch DOM updates onto a scheduler tick after a click
  // handler returns -- Markout happens to be synchronous, but bracketing
  // t0/t1 around .click() only measures "handler dispatched", not "DOM
  // updated", for the other two. Poll via rAF for the real, comparable,
  // user-perceived latency instead.
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

async function main() {
  const server = await new Server({ docroot: path.resolve(__dirname, '../demo'), port: 0, logger: () => {} }).start();
  let reactProc: ChildProcessWithoutNullStreams | undefined;
  let svelteProc: ChildProcessWithoutNullStreams | undefined;
  try {
    reactProc = await startPreview(REACT_DIR, REACT_PORT);
    svelteProc = await startPreview(SVELTE_DIR, SVELTE_PORT);
    await run(server);
  } finally {
    reactProc?.kill();
    svelteProc?.kill();
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
        return `http://127.0.0.1:${server.port}/medium/${file}`;
      },
    },
    { name: 'React', urlFor: (rows) => `http://localhost:${REACT_PORT}/?rows=${rows}` },
    { name: 'Svelte', urlFor: (rows) => `http://localhost:${SVELTE_PORT}/?rows=${rows}` },
  ];

  const results: Record<string, Record<keyof Timings, number[]>> = {};
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
    }
  }

  await browser.close();

  const headers = ['Target', 'Mount all (ms)', 'Filter (ms)', 'Sort (ms)', '20x add-to-cart (ms)'];
  const rows = Object.entries(results).map(([label, m]) =>
    crashed[label]
      ? [label, 'FAILED', '-', '-', '-']
      : [label, median(m.mount).toFixed(1), median(m.filter).toFixed(1), median(m.sort).toFixed(1), median(m.cart).toFixed(1)],
  );

  console.log(`\n${REPEATS} timed repeats per size (+1 discarded warm-up), median ms:\n`);
  console.log(toMarkdownTable(headers, rows));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
