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
import { setKitReporter } from './pages';

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

/** drop what Volar cached, and ask the editor to pull it all again */
function invalidate() {
  for (const invalidated of invalidations) {
    invalidated({ settings: {} });
  }
  server.languageFeatures.requestRefresh(false);
}

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
 * The two things HTML's own service must NOT answer here.
 *
 * These pages are `html` documents -- deliberately, so as not to displace
 * anything -- which means VS Code's own HTML support is looking at them too.
 *
 * The Outline, because it already builds one, and a second provider does not
 * merge with it the way folding ranges or document links do: the Outline view
 * shows one tree PER PROVIDER, so every page grew two identical trees.
 *
 * Formatting, because HTML's is not merely redundant here, it is destructive.
 * `:_class=${['a'].filter(s => s)}` holds a `>` that ends no tag; a formatter
 * that reads the raw text closes the tag there and every attribute after it
 * becomes text, which is a different document rather than a differently
 * indented one. `// parameters` in a definition's list comes back as two
 * attributes. So this one is not declined in favour of a better provider
 * elsewhere -- it is declined because it is wrong, and ./formatting answers
 * in its place.
 *
 * Everything else this service offers stays, because everything else either
 * merges or answers something HTML gets wrong on its own. The rule is to
 * contribute what HTML cannot answer, and an outline of ordinary markup is
 * not that.
 */
function withoutOutlineOrFormatting(service: LanguageServicePlugin): LanguageServicePlugin {
  const { documentSymbolProvider, documentFormattingProvider, ...capabilities } =
    service.capabilities;
  return {
    ...service,
    capabilities,
    create(context) {
      return {
        ...service.create(context),
        // The capability alone is not enough, which is worth knowing: Volar
        // gates ON-TYPE formatting on the capability but calls
        // `provideDocumentFormattingEdits` on every plugin that has one,
        // taking the first answer. So dropping the capability changes only
        // what the server ADVERTISES -- the editor was still handed these
        // edits, and they are made against the EMBEDDED document, whose
        // text is the page with its expressions masked. Applied to the real
        // file that inserts a masked copy of the page above the page.
        provideDocumentFormattingEdits: undefined,
      };
    },
  };
}

/**
 * Something the author has to hear, said where they are looking.
 *
 * `console.warn` in a language server goes to an output channel nobody has
 * opened, which for the one thing the sweep has to admit -- that it stopped
 * early, so an empty Problems panel is not a clean project -- is the same as
 * not saying it. The log line stays, for a bug report; the notification is
 * what gets read.
 *
 * Once per distinct message, because a workspace sweep runs whenever the
 * editor asks and a toast per pull would be its own bug.
 */
const said = new Set<string>();
function warn(message: string) {
  connection.console.warn(message);
  if (!said.has(message)) {
    said.add(message);
    connection.window.showWarningMessage(message);
  }
}

interface Settings {
  enable?: 'auto' | 'always' | 'never';
  /** one docroot or several; see docrootFor in ./diagnostics */
  docroot?: string | string[];
  /** `markout.maxPages`: the workspace sweep's bound; 0 for none */
  maxPages?: number;
}

/**
 * `markout.docroot` as SET, reduced to what it configures.
 *
 * An empty setting is how the schema spells "no answer", and a setting is
 * empty in more ways now that it may be a list: `""`, `[]`, and a list of
 * blanks left behind by editing one. All three have to arrive downstream as
 * `undefined`, or the file's own project never gets asked.
 */
function configured(value: string | string[] | undefined): string | string[] | undefined {
  const given = typeof value === 'string' ? [value] : (value ?? []);
  const kept = given.filter(entry => typeof entry === 'string' && entry.trim());
  return kept.length ? (typeof value === 'string' ? value : kept) : undefined;
}

/**
 * `markout.maxPages` as SET, or nothing.
 *
 * A setting the schema gives a default to still arrives as whatever is in a
 * `settings.json` somebody hand-edited, so a bound that is not a
 * non-negative number is no answer at all -- and no answer has to mean
 * undefined, or the default in workspace.ts is a value this file quietly
 * overrides.
 */
function bounded(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

/**
 * `markout.docroot` and `markout.enable`, as they are NOW.
 *
 * They arrive twice, which is not redundancy. `initializationOptions` is
 * what the client sent at startup and the only answer a client that cannot
 * be asked for configuration will ever give; the pull below is the live one,
 * and it is what makes changing a setting take effect in the window it was
 * changed in rather than after a reload.
 *
 * Everything downstream reads this through a getter -- see the props passed
 * to the services -- because they are built once, at initialize, and a value
 * copied in then is a value frozen then.
 */
let settings: Settings = {};

/**
 * Re-read them, and make the editor ask everything again.
 *
 * Both halves are needed for the same reason a changed fragment needs both:
 * Volar answers a diagnostic request from its cache until something clears
 * it, and the editor does not ask again until it is told to.
 */
async function settingsChanged() {
  const pulled = await configurations.get<Settings>('markout');
  if (pulled) {
    settings = {
      enable: pulled.enable,
      docroot: configured(pulled.docroot),
      maxPages: bounded(pulled.maxPages),
    };
  }
  invalidate();
}

/** the folders the window is open on, as paths, right now */
function workspaceFolders() {
  return server.workspaceFolders.all
    .filter(uri => uri.scheme === 'file')
    .map(uri => uri.fsPath);
}

connection.onInitialize(params => {
  const initial = params.initializationOptions as Settings | undefined;
  settings = {
    enable: initial?.enable,
    docroot: configured(initial?.docroot),
    maxPages: bounded(initial?.maxPages),
  };

  return server.initialize(
    params,
    createSimpleProject([createMarkoutLanguagePlugin()]),
    [
      // HTML's own features -- tag and attribute completion, folding, hovers
      // -- over the embedded HTML the plugin produces. Nothing about markout
      // is reimplemented here: the expressions are masked to characters that
      // cannot end a tag, so what this service sees is ordinary HTML at
      // exactly the offsets the author's is at
      withoutOutlineOrFormatting(
        createHtmlService({
          // WITHOUT this, `/lib.htm` in an <:import> resolves against the
          // workspace folder and the editor offers a link it cannot open
          getDocumentContext: context =>
            createDocumentContext({
              get workspaceFolders() {
                return workspaceFolders();
              },
              get docroot() {
                return settings.docroot;
              },
              decode: uri => context.decodeEmbeddedDocumentUri(uri)?.[0],
              fallback: (ref, base) =>
                resolveHtmlReference(ref, base, context.env.workspaceFolders),
            }),
        })
      ),
      createMarkoutService({
        // getters, not values: this service is built once and the window
        // outlives every setting it was built with
        get workspaceFolders() {
          return workspaceFolders();
        },
        get docroot() {
          return settings.docroot;
        },
        // `always` is how a project that uses markout without depending on
        // it -- a vendored copy, a page opened on its own -- says so
        get enable() {
          return settings.enable;
        },
        // how far the whole-project sweep goes; the default is in workspace.ts
        get limit() {
          return settings.maxPages;
        },
        // the buffers the editor is holding, which is what the compiler is
        // given instead of the disk -- the reason `readFile` is a parameter
        open: filePath => server.documents.get(URI.file(filePath))?.getText(),
        warn,
      }),
    ]
  );
});

connection.onInitialized(() => {
  server.initialized();

  // Which kits were found and which tree they were read from. `info` goes to
  // the output channel and nowhere else -- it is background unless somebody
  // is already asking why a kit is missing. A refusal is different: the kit
  // is installed, was seen, and was rejected, and the page it should have
  // served is now full of tags that do not resolve, so that one is said
  // where it will be read.
  setKitReporter((level, message) =>
    level === 'warn' ? warn(`[markout] ${message}`) : connection.console.info(`[markout] ${message}`)
  );

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
  const soon = () => {
    clearTimeout(pending);
    pending = setTimeout(invalidate, 300);
  };
  server.documents.onDidChangeContent(soon);

  /**
   * A file APPEARING is a change too, and was the one nothing here heard.
   *
   * `onDidChangeContent` fires for documents the EDITOR is holding, which a
   * file just created on disk is not until something opens it -- and a
   * package.json is often never opened at all. So the answer went stale in
   * the one direction an author cannot see: pages added under a new
   * `markout/` folder, or the `markout` section written to say where they
   * are, left the Problems panel showing what was true before the folder
   * existed. It came right on the next window reload, which is what makes it
   * read as "the extension has not noticed yet" rather than as a cache.
   *
   * `watchFiles` first, and it is the half that was missing. Volar fans
   * `workspace/didChangeWatchedFiles` out to the callbacks below, but it
   * only registers the connection handler that feeds them from INSIDE
   * `watchFiles` -- so with nothing ever asking to watch anything, the
   * notification the client was faithfully sending (synchronize.fileEvents,
   * see ./client) arrived at a server with no handler for it, and every
   * callback here was dead code. Volar's own file-system cache subscribes
   * the same way and was just as dead, which is the other half of why a
   * created file went unseen.
   *
   * The patterns are the client's, restated: a client whose
   * `didChangeWatchedFiles` supports dynamic registration is asked directly,
   * which is one fewer thing for an editor's own configuration to get wrong.
   * Both routes land on the same notification and the same debounce, so a
   * client that does both sends two and this re-pulls once.
   */
  void server.fileWatcher.watchFiles(['**/*.{html,htm}', '**/package.json']);
  server.fileWatcher.onDidChangeWatchedFiles(soon);

  // A setting is changed to be used, so it is read again and everything is
  // asked again. Registered on the ORIGINAL callback list rather than the
  // wrapper above: the wrapper's members are fired on every keystroke, and
  // re-reading the configuration that often would be a round trip to the
  // editor per edit.
  configurations.onDidChange(() => void settingsChanged());
  // and a folder added to the workspace is a project nobody has swept yet
  server.workspaceFolders.onDidChange(() => invalidate());

  // and once now, because what the client sent at startup is what it chose
  // to send: asking is the only way to be sure of the answer it would give
  void settingsChanged();
});
connection.onShutdown(() => server.shutdown());
connection.listen();
