import {
  createConnection,
  createServer,
  createSimpleProject,
} from '@volar/language-server/node';
import {
  create as createHtmlService,
  resolveReference as resolveHtmlReference,
} from 'volar-service-html';
import { URI } from 'vscode-uri';
import { createMarkoutLanguagePlugin } from './plugin';
import { createDocumentContext, createMarkoutService } from './service';

/**
 * The language server, which is deliberately the least interesting file here.
 *
 * `createSimpleProject` rather than a TypeScript project: nothing type-checks
 * expressions yet, and asking for a TS project before there is generated
 * code to check would pay for a program on every keystroke and answer
 * nothing. It is the line to change when expressions get types -- see
 * docs/design/editor-support.md.
 *
 * Node only for now, and the whole file is the only thing that would need a
 * browser twin: the plugin and the services below it touch no host API.
 */

const connection = createConnection();
const server = createServer(connection);

connection.onInitialize(params => {
  const settings = params.initializationOptions as
    | { enable?: 'auto' | 'always' | 'never'; docroot?: string }
    | undefined;
  const folders = (params.workspaceFolders ?? [])
    .map(f => URI.parse(f.uri))
    .filter(uri => uri.scheme === 'file')
    .map(uri => uri.fsPath);

  return server.initialize(
    params,
    createSimpleProject([createMarkoutLanguagePlugin()]),
    [
      // HTML's own features -- tag and attribute completion, folding, hovers
      // -- over the embedded HTML the plugin produces. Nothing about markout
      // is reimplemented here: the expressions are masked to characters that
      // cannot end a tag, so what this service sees is ordinary HTML at
      // exactly the offsets the author's is at
      createHtmlService({
        // WITHOUT this, `/lib.htm` in an <:import> resolves against the
        // workspace folder and the editor offers a link it cannot open
        getDocumentContext: context =>
          createDocumentContext({
            workspaceFolder: folders[0],
            docroot: settings?.docroot,
            decode: uri => context.decodeEmbeddedDocumentUri(uri)?.[0],
            fallback: (ref, base) =>
              resolveHtmlReference(ref, base, context.env.workspaceFolders),
          }),
      }),
      createMarkoutService({
        workspaceFolder: folders[0],
        docroot: settings?.docroot,
        // `always` is how a project that uses markout without depending on
        // it -- a vendored copy, a page opened on its own -- says so
        enable: settings?.enable,
        // the buffers the editor is holding, which is what the compiler is
        // given instead of the disk -- the reason `readFile` is a parameter
        open: filePath => server.documents.get(URI.file(filePath))?.getText(),
      }),
    ]
  );
});

connection.onInitialized(() => server.initialized());
connection.onShutdown(() => server.shutdown());
connection.listen();
