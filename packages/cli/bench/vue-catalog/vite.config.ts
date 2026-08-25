import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Vapor mode, which is the whole reason this port exists: every component
// opts in with `<script setup vapor>`, and the compiler emits direct DOM
// operations instead of a virtual-DOM render function.
//
// The alias is not optional. A compiled Vapor template imports `template`,
// `renderEffect` and `setText` from 'vue', and the default bundler entry
// (vue.runtime.esm-bundler.js) does not export them -- only the
// runtime-with-vapor build does. The `.prod` variant is the one to point at:
// the dev build carries warning machinery that would show up as our numbers.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      vue: path.resolve(here, 'node_modules/vue/dist/vue.runtime-with-vapor.esm-browser.prod.js'),
    },
  },
});
