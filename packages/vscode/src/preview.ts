import { spawn, type ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { build, type BuildResult } from '@markout-lang/core';

/**
 * Preview and Build, without asking anyone to install anything.
 *
 * Two buttons, and they reach the compiler by two different routes for one
 * reason: **the editor's process runs no web server.** That is the claim the
 * monorepo split was made to satisfy, and
 * [dependencies.test.ts](../test/dependencies.test.ts) asserts it.
 *
 * - **Build** is a compile written to disk, with no HTTP in it, so it runs
 *   HERE, in process, through core's `build`. It moved into core to make that
 *   possible.
 * - **Preview** needs a server, so it runs THERE: a child process, spawned
 *   from a bundled copy of the `markout` command.
 *
 * Both run in `--client` mode, which is the same delivery mode and not a
 * coincidence. `build` compiles and stops; the preview serves what `build`
 * would have written. So the preview shows the page that will be deployed
 * rather than a served render of it -- a different page in every respect
 * docs/concepts/isomorphism.md lists, and the wrong one for an audience with
 * no Node in the request path.
 *
 * It follows that no page expression, and so no KIT's expression, is ever
 * evaluated by either button. Compile-time evaluation is sandboxed
 * (docs/design/code-execution.md) and nothing here renders, so for somebody
 * working entirely through this sidebar a kit's code runs in their browser
 * and nowhere else.
 *
 * The child is started with `process.execPath` -- the node the editor is
 * itself running on. That is the whole trick, and it answers the objection
 * that made this design want an in-process server in the first place: there
 * is no PATH lookup, so none of the ways a PATH lookup fails for this
 * audience can happen. No npm, no shell, no version manager, nothing on
 * `/usr/bin` to find. See docs/design/without-node.md.
 */

/** the bundled `markout` command, beside the extension's own bundles */
const SIDECAR = 'markout-cli.js';
/** the browser runtime, copied in by scripts/bundle.mjs */
const RUNTIME = 'markout-runtime.js';

let server: ChildProcess | undefined;
let address: string | undefined;
let output: vscode.OutputChannel | undefined;

/**
 * Whether a preview is up, and a way to hear when that changes.
 *
 * The view shows one row for it -- Preview, or Stop preview -- so it has to
 * be told, and a server can stop without being asked: a port taken, a crash.
 */
const changed = new vscode.EventEmitter<void>();
export const onPreviewChanged = changed.event;

export function previewRunning(): boolean {
  return !!server;
}

export function registerPreview(context: vscode.ExtensionContext) {
  // Set for THIS process, and read at call time rather than at load time --
  // core walks two levels up from its own directory to find the runtime, and
  // bundled into an extension there is nothing two levels up. Without it
  // `build` refuses to write and says why, which is better than writing
  // pages that never come alive.
  process.env.MARKOUT_RUNTIME_BUNDLE = context.asAbsolutePath(path.join('dist', RUNTIME));
  context.subscriptions.push(
    vscode.commands.registerCommand('markout.preview', () => preview(context)),
    vscode.commands.registerCommand('markout.stopPreview', () => stop()),
    vscode.commands.registerCommand('markout.build', () => runBuild()),
    { dispose: () => stop() }
  );
}

/** the docroot the sidebar decided this window is about */
let docrootOf: () => string | undefined = () => undefined;
export function usingDocroot(fn: () => string | undefined) {
  docrootOf = fn;
}

function channel(): vscode.OutputChannel {
  return (output ??= vscode.window.createOutputChannel('Markout'));
}

async function preview(context: vscode.ExtensionContext) {
  const docroot = docrootOf();
  if (!docroot) {
    vscode.window.showInformationMessage('Markout: no project open to preview.');
    return;
  }
  if (server && address) {
    // already up: the button means "show me", not "start another one"
    return vscode.env.openExternal(vscode.Uri.parse(address));
  }
  const port = await freePort();
  const sidecar = context.asAbsolutePath(path.join('dist', SIDECAR));
  const log = channel();
  log.appendLine(`> markout ${docroot} --dev --client --port ${port}`);
  server = spawn(
    process.execPath,
    [sidecar, docroot, '--dev', '--client', '--port', String(port)],
    {
      cwd: docroot,
      env: {
        ...process.env,
        // `process.execPath` is the editor's binary, which is Electron. This
        // is what tells it to be node instead of trying to start an app --
        // the documented way to run a script with the editor's own runtime,
        // and the reason no node has to be found on a PATH.
        ELECTRON_RUN_AS_NODE: '1',
        MARKOUT_RUNTIME_BUNDLE: context.asAbsolutePath(path.join('dist', RUNTIME)),
      },
    }
  );
  await setRunning(true);
  server.stdout?.on('data', chunk => log.append(String(chunk)));
  server.stderr?.on('data', chunk => log.append(String(chunk)));
  server.on('exit', code => {
    // A server that stopped on its own -- a port taken, a crash -- must not
    // leave a Stop button and a dead address behind, which is how a second
    // press produces "already running" for something that is not.
    code && log.appendLine(`[markout] preview exited with code ${code}`);
    server = undefined;
    address = undefined;
    void setRunning(false);
  });
  address = `http://127.0.0.1:${port}/`;
  // Given to the browser only once the port answers. Opening immediately
  // races the compile of the first page and shows a connection error to
  // somebody who did nothing wrong.
  if (await listening(port)) {
    await vscode.env.openExternal(vscode.Uri.parse(address));
  } else {
    log.show(true);
    vscode.window.showErrorMessage(
      'Markout: the preview did not start — see the Markout output channel.'
    );
  }
}

function stop() {
  server?.kill();
  server = undefined;
  address = undefined;
  void setRunning(false);
}

function setRunning(running: boolean) {
  changed.fire();
  return vscode.commands.executeCommand('setContext', 'markout.previewRunning', running);
}

async function runBuild() {
  const docroot = docrootOf();
  if (!docroot) {
    vscode.window.showInformationMessage('Markout: no project open to build.');
    return;
  }
  // beside the docroot rather than inside it, which is the rule `markout
  // build` follows: an outdir under the docroot is one the next run would
  // compile its own output from
  const outdir = path.join(path.dirname(docroot), 'dist');
  const log = channel();
  log.appendLine(`> markout build ${docroot} ${outdir}`);
  let result: BuildResult;
  try {
    result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Markout: building…' },
      () => build({ docroot, outdir, gitignore: true })
    );
  } catch (e) {
    log.appendLine(`[markout] ${(e as Error).message}`);
    log.show(true);
    vscode.window.showErrorMessage(`Markout: ${(e as Error).message}`);
    return;
  }
  // the page an error is IN, since a build sweeps every page and "unknown
  // tag" on its own names nothing the reader can open
  const problems = [
    ...result.kitErrors,
    ...result.errors.map(e => `${e.pathname}: ${e.error.msg}`),
  ];
  problems.forEach(msg => log.appendLine(`[markout] ${msg}`));
  if (problems.length) {
    log.show(true);
    vscode.window.showErrorMessage(
      `Markout: the build reported ${problems.length} problem(s) — see the Markout output.`
    );
    return;
  }
  log.appendLine(`[markout] ${result.pages.length} page(s) written to ${outdir}`);
  const open = await vscode.window.showInformationMessage(
    `Markout: ${result.pages.length} page(s) written to dist/`,
    'Reveal'
  );
  open && (await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outdir)));
}

/**
 * A port nothing is on.
 *
 * Asked of the OS by binding zero and letting go, which leaves a window in
 * which something else could take it -- so the failure is handled rather than
 * prevented: the child says the port is busy, the channel shows it, and the
 * next press asks for another one.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const found = probe.address();
      probe.close(() =>
        typeof found === 'object' && found
          ? resolve(found.port)
          : reject(new Error('no port'))
      );
    });
  });
}

/** whether the child is answering yet, within a few seconds */
async function listening(port: number, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (!server) {
      return false;
    }
    const up = await new Promise<boolean>(resolve => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.on('connect', () => (socket.destroy(), resolve(true)));
      socket.on('error', () => resolve(false));
    });
    if (up) {
      return true;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}
