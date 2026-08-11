import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await esbuild.build({
  entryPoints: [path.join(root, 'src/runtime/web/browser.ts')],
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'iife',
  target: ['es2022'],
  outfile: path.join(root, 'dist/markout-runtime.js'),
});

console.log('built dist/markout-runtime.js');
