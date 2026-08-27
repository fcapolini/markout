import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The port imports `../../shared/catalog.mjs`, which is above this directory,
// and the repo has lockfiles above it as well. Both make Next guess a tracing
// root and warn about the guess; saying which root is meant is cheaper than
// reading that warning on every build, and a benchmark's build output is
// something a person actually reads.
const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingRoot: path.resolve(here, '../..'),
};
