import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadClientCode, runtimeBundlePath } from '../../src/render/runtime-bundle';

/**
 * Where a host that repackages this code says its runtime is.
 *
 * Two ways to say it, and the order matters more than it looks. A parameter
 * reaches one build or one middleware; the environment variable reaches
 * everything the process can see, and then everything IT starts.
 *
 * That difference cost a day. The VS Code extension used to set the
 * variable on its own process, and an extension host's environment is
 * inherited by every terminal the editor opens -- so a dev server started
 * in this repository served the INSTALLED extension's runtime to pages
 * compiled by the checkout. Nothing threw. The pages rendered. The browser
 * ran a version from a week earlier, and the symptoms read exactly like two
 * bugs in the language: a dependency that would not resolve and bindings
 * with no element to bind to.
 *
 * So the parameter wins, and the variable stays for the one case a
 * parameter cannot reach: a separate process, told through its environment
 * because that is the only channel there is.
 */
const HOME = process.env.MARKOUT_RUNTIME_BUNDLE;
afterEach(() => {
  HOME === undefined
    ? delete process.env.MARKOUT_RUNTIME_BUNDLE
    : (process.env.MARKOUT_RUNTIME_BUNDLE = HOME);
});

describe('finding the runtime bundle', () => {
  it('takes the parameter over the environment', () => {
    process.env.MARKOUT_RUNTIME_BUNDLE = '/from/the/environment.js';

    expect(runtimeBundlePath('/from/the/caller.js')).toBe('/from/the/caller.js');
  });

  it('falls back to the environment, for a process that has no caller', () => {
    process.env.MARKOUT_RUNTIME_BUNDLE = '/from/the/environment.js';

    expect(runtimeBundlePath()).toBe('/from/the/environment.js');
  });

  it('walks to its own package when nobody said', () => {
    delete process.env.MARKOUT_RUNTIME_BUNDLE;

    expect(runtimeBundlePath()).toMatch(/dist[/\\]markout-runtime\.js$/);
  });

  it('reads what the parameter names, whatever the environment says', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-bundle-'));
    const mine = path.join(dir, 'mine.js');
    fs.writeFileSync(mine, '// the caller\n');
    process.env.MARKOUT_RUNTIME_BUNDLE = path.join(dir, 'not-this-one.js');

    expect(loadClientCode(mine)).toBe('// the caller\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
