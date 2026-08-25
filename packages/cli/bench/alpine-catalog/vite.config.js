import { defineConfig } from 'vite';

// No framework plugin, on purpose: Alpine has no compiler and no component
// step. The build here is only bundling + minifying Alpine and the shared
// catalog generator, which is what `npm install alpinejs` gives an Alpine
// app anyway -- the markup in index.html is shipped exactly as written.
export default defineConfig({});
