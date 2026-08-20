import { execFileSync } from 'child_process';

/**
 * Where `npm install -g` puts packages.
 *
 * The compiler finds a globally installed kit by walking up from its own
 * location: a globally installed CLI sits inside the global `node_modules`,
 * so the walk arrives there on its own. The extension cannot do that -- it
 * lives under the editor's extensions directory, and `process.execPath` is
 * the editor, not the node the user installs with. Neither says anything
 * about where a version manager put the prefix.
 *
 * So ask npm, once per process. This runs in the language server rather than
 * the extension host, and `kitsFor` already rescans on a timer, so a single
 * few-hundred-millisecond spawn behind a cache costs nothing anyone can see.
 */
let cached: string | null | undefined;

export function globalNodeModules(): string | null {
  if (cached !== undefined) {
    return cached;
  }
  cached = lookUp();
  return cached;
}

function lookUp(): string | null {
  try {
    const out = execFileSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['root', '-g'],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    // npm prints the path whether or not it exists yet
    return out.length > 0 ? out : null;
  } catch {
    // no npm on PATH, or it took too long: the user simply has no global kits
    return null;
  }
}

/** test seam: pretend npm answered this, and skip the spawn */
export function setGlobalNodeModules(value: string | null): void {
  cached = value;
}

/** test seam: forget the answer, so the next call asks again */
export function resetGlobalNodeModules(): void {
  cached = undefined;
}
