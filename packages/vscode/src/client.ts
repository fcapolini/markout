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
  const settings = vscode.workspace.getConfiguration('markout');
  const options: LanguageClientOptions = {
    // what the server starts with. It asks for these again itself, and again
    // whenever they change -- see synchronize below -- so this is the first
    // answer rather than the only one
    initializationOptions: {
      enable: settings.get<'auto' | 'always' | 'never'>('enable', 'auto'),
      // string or array: the server reduces an empty one to "not set"
      docroot: settings.get<string | string[]>('docroot'),
    },
    // `html`, not a language of our own: see PAGE_LANGUAGE_ID. Whether a
    // given HTML file is a markout page is a question about the PROJECT, and
    // the server answers it -- see isMarkoutProject
    documentSelector: [{ language: 'html', scheme: 'file' }],
    synchronize: {
      // a page is recompiled when a fragment it imports changes, and the
      // fragment may never have been opened -- so the server has to hear
      // about files the editor is not showing. `package.json` is watched for
      // the same reason and is opened even less often: it carries
      // `markout.docroot`, which decides what every absolute path means, and
      // the dependency that answers whether this is a markout project at all
      fileEvents: vscode.workspace.createFileSystemWatcher('**/{*.html,*.htm,package.json}'),
      // and `markout.docroot` decides what every absolute path in every page
      // means, so changing it has to reach the server that is already
      // running. Without this the client sends nothing, the server never
      // re-reads, and a setting only takes effect on the next window
      configurationSection: 'markout',
    },
  };
  client = new LanguageClient('markout', 'Markout', server, options);
  await client.start();
}

export async function deactivate() {
  await client?.stop();
  client = undefined;
}
