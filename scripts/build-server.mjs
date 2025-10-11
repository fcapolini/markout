import { build } from 'esbuild';

build({
  entryPoints: ['./src/index.ts'],// Entry file
  outfile: './dist/index.js',// Output file
  bundle: true,// Bundle dependencies
  platform: 'node',// Target Node.js
  target: 'node16',// Specify Node.js version
  sourcemap: true,// Include sourcemaps
  minify: false,// Minify output for production
  // sourcemap: false,// Include sourcemaps
  // minify: true,// Minify output for production
  loader: { '.ts': 'ts' },// Add loader for TS
}).then(() => {
  console.log('Build completed!');
}).catch(() => process.exit(1));
