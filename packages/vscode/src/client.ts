import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';

/**
 * The VS Code end of it: start the server, point it at markout files, stop it.
 *
 * Everything specific to this editor is in this file, so that supporting a
 * second one is writing a second file this size rather than untangling the
 * first.
 */

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const module = context.asAbsolutePath(path.join('dist', 'server.js'));
  const server: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6039'] },
    },
  };
  const options: LanguageClientOptions = {
    documentSelector: [{ language: 'markout' }],
    synchronize: {
      // a page is recompiled when a fragment it imports changes, and the
      // fragment may never have been opened -- so the server has to hear
      // about files the editor is not showing
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{html,htm}'),
    },
  };
  client = new LanguageClient('markout', 'Markout', server, options);
  await client.start();
}

export async function deactivate() {
  await client?.stop();
  client = undefined;
}
