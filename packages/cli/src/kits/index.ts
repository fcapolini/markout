/**
 * Installing a kit without npm, as a library.
 *
 * The subpath `@markout-lang/cli/kits` exists for ONE consumer: the VS Code
 * extension's sidebar, whose checkbox has to install a kit exactly the way
 * `markout add` does or the two halves of one feature drift. It exports the
 * installer and nothing else -- no `Server`, no `build`, no commander -- so
 * an editor process gets the fetching without the web server the rest of this
 * package is built on.
 *
 * That is a boundary, not a convention, and
 * [dependencies.test.ts](../../../vscode/test/dependencies.test.ts) asserts
 * it by walking what this file can actually reach.
 *
 * Why it is here rather than in `@markout-lang/core`: core is the compiler,
 * and none of this is compiling. Core keeps `.markout/kits.json` itself --
 * the format, its reader and its writer -- because the compiler reports a
 * declared kit that is not installed and must read the file to do it. It does
 * not keep the thing that goes and gets one.
 */
export { addKits, parseSpec, restoreKits, type InstallReport } from './install';
export { manifestDirFor, writeGitignore, writeManifest } from './manifest';
export {
  featuredKits,
  FEATURED_SCOPE,
  KIT_KEYWORD,
  searchKits,
  type KitListing,
} from './listing';
export { cacheDir, registryUrl, resolveKit, type KitVersion } from './registry';
export { untar, type UntarResult } from './untar';
