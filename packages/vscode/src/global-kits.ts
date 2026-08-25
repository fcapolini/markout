import { execFile, execFileSync } from 'child_process';

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
 *
 * Except that npm is frequently not there to ask. The server is a child of
 * the extension host, and an editor started from the Dock or the Finder on
 * macOS is a child of launchd, whose PATH is `/usr/bin:/bin:/usr/sbin:/sbin`
 * -- which holds no Homebrew, no nvm, no fnm, no volta, and so no npm. VS
 * Code resolves the login shell's environment to paper over this, but it is
 * best-effort: it is skipped when the editor was started from a terminal
 * that already had a good PATH, it can time out, and
 * `terminal.integrated.inheritEnv: false` turns it off. When it does not
 * happen the spawn fails with ENOENT and the answer is "no global kits" --
 * silently, and for exactly the audience the fallback exists for, whose
 * pages then report every tag their kit defines as an unknown one.
 *
 * So there are two ways of asking, and the second is the login shell --
 * which is where a version manager put npm on the PATH to begin with. It is
 * second because it is slow: an interactive zsh with a prompt framework in
 * it can take seconds, and slow matters here, since `kitsFor` is synchronous
 * and a compile waits on it. So the shell is asked in the BACKGROUND. This
 * answers "none yet" meanwhile, and the real answer lands in time for the
 * next scan a few seconds later -- a kit appearing shortly after the window
 * opens, which is the same thing the TTL already does for a kit installed
 * while the window is open.
 */

/** the answer, once there is one; `null` means asked, and there is none */
let cached: string | null | undefined;
/** whether the slow way is already running, so that it runs once */
let asking = false;

export interface Probes {
  /** ask the npm on this process's PATH; its output, or nothing */
  npm: () => string | null;
  /** ask the login shell, calling back when it answers */
  shell: (done: (out: string | null) => void) => void;
}

export function globalNodeModules(probes: Partial<Probes> = {}): string | null {
  if (cached !== undefined) {
    return cached;
  }
  // the slow way is running, and until it answers there is nothing to say.
  // Retrying the fast way here would respawn a failing npm on every scan
  if (asking) {
    return null;
  }
  const direct = firstLine((probes.npm ?? askNpm)());
  if (direct) {
    cached = direct;
    return cached;
  }
  asking = true;
  (probes.shell ?? askTheLoginShell)(out => {
    cached = firstPath(out);
  });
  return null;
}

/** npm as this process can reach it, which on a desktop launch is often not */
function askNpm(): string | null {
  try {
    return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // not on PATH, or it took too long
    return null;
  }
}

/**
 * Ask again through the shell the user actually logs in to.
 *
 * `-ilc`, interactive as well as login, because that is where the answer is:
 * nvm, fnm and asdf define themselves in `.zshrc`/`.bashrc`, which a login
 * shell that is not interactive never reads. An interactive shell also
 * prints prompts and whatever else an rc file has to say, which is why the
 * output is searched for a path rather than taken whole.
 *
 * Not on Windows, which has no such shell and does not need one: a process
 * there is handed the environment its user's PATH is in.
 */
function askTheLoginShell(done: (out: string | null) => void): void {
  if (process.platform === 'win32') {
    done(null);
    return;
  }
  const child = execFile(
    process.env.SHELL || '/bin/sh',
    ['-ilc', 'npm root -g'],
    { encoding: 'utf8', timeout: 15000, windowsHide: true },
    // the exit code is not consulted: an rc file whose last line failed
    // leaves an interactive shell exiting non-zero having printed the answer
    // perfectly well, and the answer is what is wanted
    (_error, stdout) => done(stdout ?? null)
  );
  // nothing waits on this, so it must not be a reason for the process to
  // stay up: a shell that hangs would otherwise hold the server -- and a
  // test suite -- open for the whole timeout
  child.unref();
  child.stdin?.end();
}

/**
 * All npm printed, which is one path -- and NOT looked at, since on Windows
 * it is `C:\\Users\\...` and a check for a leading slash would refuse it.
 * npm prints the path whether or not it exists yet.
 */
function firstLine(out: string | null): string | null {
  const trimmed = (out ?? '').trim();
  return trimmed.length > 0 ? trimmed.split('\n')[0].trim() : null;
}

/**
 * The path in what a SHELL printed, which is not all it printed: an
 * interactive one runs an rc file first, and an rc file may greet you. Posix
 * only -- the shell is not asked on Windows -- so an absolute path is one
 * that starts with a slash.
 */
function firstPath(out: string | null): string | null {
  for (const line of (out ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('/')) {
      return trimmed;
    }
  }
  return null;
}

/** test seam: pretend npm answered this, and skip the spawn */
export function setGlobalNodeModules(value: string | null): void {
  cached = value;
  asking = true;
}

/** test seam: forget the answer, so the next call asks again */
export function resetGlobalNodeModules(): void {
  cached = undefined;
  asking = false;
}
