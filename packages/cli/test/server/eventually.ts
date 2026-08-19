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
 * the same reason.
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
