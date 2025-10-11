import { build } from 'esbuild';

build({
  entryPoints: ['./src/client.ts'],
  outfile: './dist/client.js',
  bundle: true,
  platform: 'browser',
  sourcemap: true,
  minify: true,
  loader: { '.ts': 'ts' },
}).then(() => {
  console.log('Build completed!');
}).catch(() => process.exit(1));
