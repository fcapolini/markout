import {
  createConnection,
  createServer,
  createSimpleProject,
  type LanguageServicePlugin,
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

/**
 * The one way to tell Volar that a diagnostic it already computed is stale.
 *
 * When a service declares `interFileDependencies: false` -- which markout's
 * does, because that flag is also what turns the pull model on, and with it
 * the Problems panel for files nobody has opened -- Volar caches each
 * document's diagnostics against its VERSION. A page whose imported fragment
 * changed has the version it had a moment ago, so the cache answers with the
 * errors from before the edit, however many refreshes are asked for.
 *
 * The only invalidation Volar exposes is the configuration-changed callback,
 * which its diagnostics feature registers precisely in order to drop that
 * cache. It reaches that callback through the environment, which reads it off
 * `server.configurations` when the project is set up -- so owning that
 * registration, before `initialize` builds the environment, is what lets the
 * server fire it on the event that actually invalidates: a document changing.
 *
 * Firing it here rather than having the client send a spurious
 * `didChangeConfiguration` also leaves the real configuration cache alone.
 */
const invalidations = new Set<Parameters<typeof server.configurations.onDidChange>[0]>();
const configurations = server.configurations;
server.configurations = {
  ...configurations,
  onDidChange(cb) {
    invalidations.add(cb);
    const registered = configurations.onDidChange(cb);
    return {
      dispose() {
        invalidations.delete(cb);
        registered.dispose();
      },
    };
  },
};

/**
 * The one thing HTML's own service must NOT answer here: the Outline.
 *
 * These pages are `html` documents -- deliberately, so as not to displace
 * anything -- which means VS Code's own HTML support is looking at them too,
 * and it already builds an outline. A second provider does not merge with
 * it the way folding ranges or document links do: the Outline view shows one
 * tree PER PROVIDER, so every page grew two identical trees.
 *
 * Everything else this service offers stays, because everything else either
 * merges or answers something HTML gets wrong on its own -- an expression
 * holding a `>` ends a tag for anybody parsing the raw text, and the whole
 * point of the embedded document is that it does not. The rule is to
 * contribute what HTML cannot answer, and an outline of ordinary markup is
 * not that.
 */
function withoutOutline(service: LanguageServicePlugin): LanguageServicePlugin {
  const { documentSymbolProvider, ...capabilities } = service.capabilities;
  return { ...service, capabilities };
}

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
      withoutOutline(
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
        })
      ),
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

connection.onInitialized(() => {
  server.initialized();

  /**
   * Ask the editor to re-pull diagnostics whenever anything changes.
   *
   * The pull model asks about a document when THAT document changes, and a
   * markout page's faults can be in a file it imports -- so editing a
   * fragment has to make every page that reads it ask again. Two things are
   * needed for that: dropping what Volar cached for those pages, and telling
   * the editor to ask again. Neither works alone -- a refresh on its own is
   * answered from the cache, and a cleared cache on its own is never
   * consulted.
   *
   * Debounced, because "anything changes" is every keystroke, and this asks
   * the editor to re-pull every open document.
   */
  let pending: NodeJS.Timeout | undefined;
  server.documents.onDidChangeContent(() => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      for (const invalidate of invalidations) {
        invalidate({ settings: {} });
      }
      server.languageFeatures.requestRefresh(false);
    }, 300);
  });
});
connection.onShutdown(() => server.shutdown());
connection.listen();
