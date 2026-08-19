import type { Request, Response } from 'express';

/**
 * Dev-mode live reload: the page holds a stream open, and the server says
 * "reload" when it throws its compiled pages away.
 *
 * Tied to cache invalidation rather than to the filesystem directly, and
 * deliberately so -- the watcher already decides what counts as a change
 * (see ./watcher, which follows symlinks precisely so a kit reached by one
 * is not missed), and the browser should reload exactly when the server has
 * stopped believing what it last served. One source of truth, so the two
 * cannot disagree about whether something changed.
 *
 * Server-sent events rather than a WebSocket: the traffic is one-way, it
 * needs no dependency, it survives a proxy that only speaks HTTP, and
 * `EventSource` reconnects on its own. That last one is what makes a server
 * RESTART work -- see the boot id below.
 *
 * Dev only, and it exists in the middleware rather than the compiler for the
 * same reason: nothing here can reach a `build`, which has no server to
 * stream from and would bake a dead connection into a static deliverable.
 */

/**
 * Where the stream lives.
 *
 * Named like the runtime's own path rather than dot-prefixed, for the same
 * reason it is: a name a page can see is a name a page can be told about. It
 * shadows a real file of that name, which is worth a warning and gets one.
 */
export const RELOAD_REQ = '/markout-reload';

/**
 * Long enough to be cheap, short enough that a proxy idle timeout does not
 * silently drop the stream and leave a page that no longer reloads with
 * nothing to say so.
 */
const HEARTBEAT_MS = 30_000;

/**
 * One save can produce several watcher events, and each would be a separate
 * reload -- so they are coalesced. Short enough not to be felt, long enough
 * to cover an editor that writes a file by replacing it.
 */
const COALESCE_MS = 50;

export interface Reloader {
  /**
   * Whether this request WAS the stream, in which case it has been taken
   * over and the caller must not answer it.
   */
  handle(req: Request, res: Response): boolean;
  /** tell every open page to reload; coalesced */
  notify(): void;
  /** the markup a dev page carries, `<script>` included, with this
   *  response's CSP nonce on it when the server was asked for one */
  script(nonce?: string): string;
  /** drop every open stream, so nothing holds the process open */
  close(): void;
}

export function createReloader(bootId = `${Date.now()}-${process.pid}`): Reloader {
  const open = new Set<Response>();
  let pending: NodeJS.Timeout | undefined;

  const send = (res: Response, event: string, data: string) => {
    try {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    } catch {
      // a client that vanished between the check and the write; the 'close'
      // handler will take it out of the set
      open.delete(res);
    }
  };

  const heartbeat = setInterval(() => {
    // an SSE comment: it keeps the connection warm and is ignored by the
    // client, which is exactly what a keep-alive should be
    open.forEach(res => {
      try {
        res.write(': ping\n\n');
      } catch {
        open.delete(res);
      }
    });
  }, HEARTBEAT_MS);
  // this is a dev convenience, not a reason for `node` never to exit
  heartbeat.unref();

  return {
    handle(req, res) {
      if (req.path !== RELOAD_REQ) {
        return false;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // a proxy that buffers would hold every event until the stream ends,
        // which for a stream that never ends means forever
        'X-Accel-Buffering': 'no',
      });
      open.add(res);
      // The boot id, on every connection including a reconnect. A page that
      // sees a DIFFERENT one than it saw before is a page whose server has
      // restarted while it was away -- so it reloads, which is what anyone
      // who just restarted a dev server expects and what a plain "reload on
      // message" protocol cannot express.
      send(res, 'hello', bootId);
      req.on('close', () => open.delete(res));
      return true;
    },

    notify() {
      pending && clearTimeout(pending);
      pending = setTimeout(() => {
        pending = undefined;
        open.forEach(res => send(res, 'reload', '1'));
      }, COALESCE_MS);
      pending.unref();
    },

    script(nonce?: string) {
      return reloadScript(nonce);
    },

    close() {
      clearInterval(heartbeat);
      pending && clearTimeout(pending);
      open.forEach(res => {
        try {
          res.end();
        } catch {
          // already gone, which is the outcome wanted anyway
        }
      });
      open.clear();
    },
  };
}

/**
 * Small enough to inline, so a reloading page costs no extra request.
 *
 * `hello` carries the server's boot id: the first one is remembered and any
 * later one that differs means the server restarted, so the page reloads
 * itself rather than sitting there connected to a server that has forgotten
 * it. `EventSource` does the reconnecting.
 */
const RELOAD_BODY =
  `(function(){` +
  `var b=null,s=new EventSource(${JSON.stringify(RELOAD_REQ)});` +
  `s.addEventListener("hello",function(e){` +
  `if(b!==null&&b!==e.data){location.reload();return}b=e.data});` +
  `s.addEventListener("reload",function(){location.reload()})})()`;

/**
 * Carries the response's CSP nonce when there is one -- see MarkoutProps.csp.
 *
 * Dev is included in that feature rather than exempted from it, and this is
 * the reason to be careful about it: the reload script is the one markout
 * adds after the document has been serialized, so it is the one that would
 * be left out. A dev server that breaks under the policy an application just
 * adopted is the version of this feature people would meet first.
 *
 * The nonce is a base64 or caller-supplied token going into a double-quoted
 * attribute, so the character that would end it early is `"`. Refused rather
 * than escaped: a nonce containing one is a caller mistake, and one quietly
 * rewritten no longer matches the header it was minted for.
 */
function reloadScript(nonce?: string): string {
  const attr = nonce && !nonce.includes('"') ? ` nonce="${nonce}"` : '';
  return `<script data-markout-reload${attr}>${RELOAD_BODY}</script>`;
}

/**
 * The script, put where a script belongs.
 *
 * Before `</body>` when there is one, and appended when there is not -- an
 * error page is built by hand and a page may have been authored without one,
 * and neither is a reason for the reload to stop working. Matched on the LAST
 * occurrence, since the string can legitimately appear earlier inside a
 * `<script>` or a comment.
 */
export function withReloadScript(html: string, script: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0
    ? html + script
    : html.substring(0, at) + script + html.substring(at);
}
