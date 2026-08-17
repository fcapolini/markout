// Generates scaled-catalog variants of bench/medium/index.html for perf benchmarking.
// Same app, same components -- only the `:models` seed array grows, so the
// generated catalog (categories x models x finishes) reaches the target row count.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeModels, FINISHES } from '../bench/shared/catalog.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bench/medium');
const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

// categories.length (6) * finishes.length (5) = 30 rows per model
const variants = { 'bench-1000.html': 34, 'bench-10000.html': 334 };

for (const [file, modelCount] of Object.entries(variants)) {
  const rows = modelCount * 6 * FINISHES.length;
  const models = makeModels(modelCount);
  const literal = '[' + models.map(m => `'${m}'`).join(', ') + ']';
  const out = src
    .replace(/:models=\$\{\[[^\]]*\]\}/, `:models=\${${literal}}`)
    // the id formula spaces categories by `10 models * 5 finishes`; scale
    // that spacing too, or ids collide across categories once models.length
    // != 10, which starves :for-key of a real key and forces spurious
    // dispose/recreate churn on every reorder
    .replace('const n = c * 50 + m * 5 + f;', `const n = c * (${modelCount} * 5) + m * 5 + f;`)
    // largest page-size chip becomes "show everything", to benchmark a full mount
    .replace(':for-each=${[12, 24, 48, 300]}', `:for-each=\${[12, 24, 48, ${rows}]}`)
    .replace('<title>Medium | Catalog benchmark</title>', `<title>Medium bench (${rows} rows)</title>`);
  fs.writeFileSync(path.join(dir, file), out);
  console.log(`wrote bench/medium/${file}: ${modelCount} models -> ${rows} rows`);
}
