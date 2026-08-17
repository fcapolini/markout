import fs from 'fs';
import path from 'path';

/**
 * Watch a docroot for changes, symlinked directories included.
 *
 * `fs.watch` with `recursive: true` does NOT descend through a symlink --
 * measured, not assumed: a write through a linked directory produces no
 * event at all, while a direct write in the same tree does. That is not a
 * hypothetical in this repository, where `kits/bootstrap/std-kit` is a link
 * to the std kit next door: editing the std kit did not invalidate the
 * compiled pages that had imported it, so a dev server went on serving the
 * old ones with nothing to say it was doing so.
 *
 * Which is the failure the page cache is written to avoid. It empties
 * itself on any change rather than working out which pages saw the file
 * that moved, and it declines to cache at all when no watcher can be
 * established, on the grounds that a stale page is worse than a slow one and
 * is the kind of failure somebody debugs for an hour before suspecting the
 * server. A watcher that silently covers only part of the tree is that same
 * failure wearing a watcher.
 *
 * So: one recursive watcher on the docroot, and another on each linked
 * directory below it, found by walking. All of them clear the cache; none of
 * them holds the process open.
 *
 * What this deliberately does NOT do is follow the same reasoning into
 * `node_modules`. A kit installed from npm does not change except through
 * `npm install`, which is a restart-shaped event rather than an edit -- and
 * the mount table that will make such a kit servable is itself built once at
 * startup, so a kit installed while the server runs is not reachable
 * regardless. There is an active cost too: a recursive watch over
 * `node_modules` is the standard way to exhaust inotify watches on Linux,
 * and since invalidation here is deliberately blunt, an `npm install` would
 * clear the whole cache repeatedly while it ran. A kit under `npm link` is a
 * working tree rather than a dependency and is the one case that would want
 * watching; it should be opted into explicitly rather than reached by a
 * heuristic over resolved paths, since pnpm makes every dependency a
 * symlink. See docs/design/npm-kits.md.
 */
export interface TreeWatcher {
  close(): void;
  /** how many watchers were established, the docroot's included */
  count: number;
}

/**
 * Throws if any watcher cannot be established, having closed the ones it
 * already made -- partial coverage is the thing this exists to prevent, so
 * it is not offered as a degraded mode. The caller decides what to do about
 * it, which today means logging and not caching.
 */
export function watchTree(docroot: string, onChange: () => void): TreeWatcher {
  const watchers: fs.FSWatcher[] = [];
  // by resolved path, because following links is how a walk finds its way
  // into a cycle -- and because two links to one directory need one watcher
  const seen = new Set<string>();

  const watch = (dir: string) => {
    let real: string;
    try {
      real = fs.realpathSync(dir);
    } catch {
      // a dangling link is not this server's business, same as in build's walk
      return;
    }
    if (seen.has(real)) {
      return;
    }
    seen.add(real);
    const w = fs.watch(dir, { recursive: true }, () => onChange());
    // never a reason to hold the process open: this exists to make an
    // already-running server faster, not to keep one alive
    w.unref();
    watchers.push(w);
    for (const link of linkedDirs(dir)) {
      watch(link);
    }
  };

  try {
    watch(docroot);
  } catch (err) {
    watchers.forEach(w => w.close());
    throw err;
  }
  return {
    close: () => watchers.forEach(w => w.close()),
    count: watchers.length,
  };
}

/**
 * Every symlinked directory below `dir`, as the paths of the links
 * themselves -- watching those works as well as watching their targets and
 * reads better in a log.
 *
 * The links are not descended into here; `watchTree` does that when it
 * watches one, so a link inside a linked kit is found on the next turn.
 *
 * Skips what the rest of the system skips, and for the same reasons:
 * `node_modules` per the note above, and dot-prefixed names because `.git`
 * is large, changes constantly, and holds nothing any page reads.
 *
 * An unreadable directory is skipped rather than fatal. Its contents are
 * still covered by an ancestor's recursive watcher; all that is lost is the
 * chance to notice a link inside it, which is a better trade than refusing
 * to cache the whole site over one directory's permissions.
 */
function linkedDirs(dir: string): string[] {
  const found: string[] = [];
  const visit = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      const full = path.join(d, entry.name);
      if (entry.isSymbolicLink()) {
        // stat rather than the dirent, so that what it POINTS AT decides
        const stats = fs.statSync(full, { throwIfNoEntry: false });
        stats?.isDirectory() && found.push(full);
        continue;
      }
      entry.isDirectory() && visit(full);
    }
  };
  visit(dir);
  return found;
}
