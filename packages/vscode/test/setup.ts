import { beforeEach } from 'vitest';
import { setGlobalNodeModules } from '../src/global-kits';

/**
 * No test may see what this machine happens to have installed globally.
 *
 * `kitsFor` falls back to the global `node_modules` for a docroot with no
 * kits of its own -- which is what nearly every test here builds, a bare
 * temporary directory -- so a developer with `@markout-lang/std-kit`
 * installed globally got its tags offered in a completion test that asked
 * about two of its own. The suite passed or failed according to something no
 * part of it mentions, and worse on the machine of whoever is most likely to
 * have the kits installed.
 *
 * So: no global kits, for everybody, unless a test says otherwise. The ones
 * that are ABOUT the fallback say otherwise, by calling the same seam with a
 * root of their own.
 */
beforeEach(() => setGlobalNodeModules(null));
