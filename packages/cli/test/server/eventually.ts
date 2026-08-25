/**
 * Repeat a change until its effect shows, rather than making it once and
 * waiting longer.
 *
 * `fs.watch` is not armed the instant it returns. A write in that window
 * produces no event AT ALL -- so a single write can land where nothing is
 * listening, and then no amount of waiting afterwards will produce one. That
 * is the shape of the bug a longer timeout cannot fix: it cannot tell "not
 * notified yet" from "never going to be", and the second is what a loaded
 * suite keeps producing, because the window is between creating the server
 * and the next line of the test.
 *
 * Measured rather than reasoned about: packages/express/test/watcher.test.ts
 * establishes it against the watcher itself, and carries the same loop for
 * the same reason. Written down once, away from both, in
 * docs/design/platform-notes.md -- this cost a debugging session twice,
 * because a comment reaches the line it sits on and not the next person
 * writing the same bug in another package.
 *
 * The change is handed the attempt number so it can vary what it writes.
 * Identical bytes are a weaker event than different ones, and a platform that
 * coalesces can deliver two writes of the same content as none.
 */
export async function eventually<T>(
  change: (attempt: number) => void | Promise<void>,
  look: () => Promise<T>,
  found: (seen: T) => boolean,
  ms = 5000
): Promise<T> {
  const started = Date.now();
  let seen = await look();
  for (let attempt = 0; !found(seen) && Date.now() - started < ms; attempt++) {
    await change(attempt);
    await new Promise(r => setTimeout(r, 50));
    seen = await look();
  }
  return seen;
}

/**
 * Waits until a directory has stopped producing watcher events.
 *
 * The mirror of `eventually` above, for the other half of the same platform
 * behaviour. That one waits for an event that may never have been armed in
 * time; this one waits for events that were armed BEFORE anyone was
 * listening and arrive whenever the platform gets to them.
 *
 * Writing a fixture and then starting a server watches a directory that was
 * being written a moment ago, and FSEvents delivers that backlog after the
 * watcher is established -- so the server's page cache is emptied at an
 * arbitrary moment shortly after startup, by changes that predate it.
 * Measured on this machine: a watcher established right after 41 file writes
 * saw 0, 3 and 6 such events across three rounds, spread over more than a
 * second.
 *
 * Which is why a fixed sleep is the wrong shape and was the bug: 400ms is
 * enough on an idle machine and not enough on a loaded one, so the test that
 * used one failed about twice in twenty full-suite runs and passed alone
 * every time. A queue that drains on its own schedule is waited out by
 * watching it drain.
 *
 * Returns how many events it saw, which is what makes it possible to tell
 * "waited and nothing was pending" from "waited out a backlog".
 */
export async function quiesced(dir: string, quietMs = 300, capMs = 8000): Promise<number> {
  const fs = await import('fs');
  return new Promise<number>(resolve => {
    let events = 0;
    let quiet: NodeJS.Timeout;
    // a watcher of our own, established where the server's was: it receives
    // the same backlog, so its going quiet is the server's going quiet
    const watcher = fs.watch(dir, { recursive: true }, () => {
      events++;
      arm();
    });
    const finish = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      watcher.close();
      resolve(events);
    };
    const arm = () => {
      clearTimeout(quiet);
      quiet = setTimeout(finish, quietMs);
    };
    // a directory that never goes quiet is a test that should fail on its own
    // assertion rather than here
    const cap = setTimeout(finish, capMs);
    arm();
  });
}
