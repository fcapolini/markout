import type { LanguageServicePlugin } from '@volar/language-service';
import * as nodePath from 'path';
import type { Position } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import {
  diagnose,
  type MarkoutDiagnostic,
  folderOf,
  guessDocroot,
  isMarkoutProject,
  looksLikeMarkout,
  pathnameOf,
  resolveReference,
} from './diagnostics';
import { isPage } from './plugin';
import { fileReferenceAt } from './references';
import { fileOf, findDeclaration } from './declarations';
import { findCompletions } from './completions';
import { findHover } from './hovers';
import { findReferences } from './references-to';
import { prepareRename, renameEdits } from './rename';
import { diagnoseWorkspace } from './workspace';

/**
 * The compiler, as a language service.
 *
 * Thin on purpose: everything that is hard lives in ./diagnostics, which
 * knows nothing about Volar and is tested without it. What is here is the
 * two things that need the editor's own vocabulary — which URI is open, and
 * how a diagnostic for ANOTHER file gets reported against this one.
 */

export interface MarkoutServiceProps {
  /**
   * The folders the window is open on, in any order.
   *
   * A file's docroot is looked for under the one it is IN -- see folderOf --
   * because the folders of a multi-root workspace are separate projects, not
   * views of one.
   *
   * Read on every request rather than at startup, so that a setting changed
   * or a folder added takes effect where it is changed: server.ts passes
   * these as getters.
   */
  workspaceFolders?: string[];
  /** an explicit docroot, from `markout.docroot`; guessed when absent */
  docroot?: string;
  /** `markout.enable`: whether a project has to look like markout's */
  enable?: 'auto' | 'always' | 'never';
  /** the editor's unsaved buffers, by file path */
  open: (filePath: string) => string | undefined;
  /** something the author needs to hear about, said where they will see it */
  warn?: (message: string) => void;
  /** how many pages a workspace sweep may compile; the default is in workspace.ts */
  limit?: number;
}

/**
 * How the HTML service resolves a path it finds in the page.
 *
 * It has to be told, or it gets absolute paths wrong in a way that is worse
 * than useless: `/lib.htm` is resolved against the WORKSPACE FOLDER by
 * default, which in any project whose docroot is a subdirectory names a file
 * that does not exist -- and the editor reports "Unable to open" on a link it
 * offered. That is the ctrl-click path, which VS Code prefers over
 * go-to-definition, so a correct definition provider does not save it.
 *
 * A markout page's absolute paths mean what the SERVER will mean by them, so
 * the docroot is what they resolve against, through the compiler's own
 * resolver -- which also gets `/npm/…` into the installed package for free.
 * Anything else (a URL, a fragment, a relative path) is handed back to the
 * service's own default.
 *
 * The `base` it is given is the EMBEDDED document's uri, not the file's --
 * the same thing that catches every other service here -- so it has to be
 * decoded before it names anything on disk.
 */
export function createDocumentContext(props: {
  workspaceFolders?: string[];
  docroot?: string;
  /** turns an embedded document's uri back into the file's */
  decode: (uri: URI) => URI | undefined;
  /** the service's own resolver, for everything that is not ours */
  fallback: (ref: string, base: URI) => string | undefined;
}) {
  return {
    resolveReference(ref: string, base: string): string | undefined {
      const baseUri = props.decode(URI.parse(base)) ?? URI.parse(base);
      if (baseUri.scheme !== 'file' || !ref.startsWith('/')) {
        return props.fallback(ref, baseUri);
      }
      const filePath = baseUri.fsPath;
      const docroot =
        props.docroot ?? guessDocroot(filePath, folderOf(filePath, props.workspaceFolders));
      const target = resolveReference({
        docroot,
        fromPathname: pathnameOf(filePath, docroot),
        spec: ref,
      });
      // undefined rather than the fallback's answer: a path the compiler
      // refuses is one the page cannot reach, and offering a link to
      // something plausible would hide that
      return target ? URI.file(target).toString() : undefined;
    },
  };
}

/**
 * One diagnostic, as LSP wants it.
 *
 * `here` is the file being reported ON, which is not always the file the
 * compiler blamed: a page that imports a broken fragment has to say so
 * somewhere its author can see, or a broken library reads as a page that is
 * fine. Those are named and put at the top. In a workspace sweep there is no
 * such page -- every fault is reported against the file it is in -- so the
 * argument is left out.
 */
function asDiagnostic(d: MarkoutDiagnostic, here?: string) {
  const own = here === undefined || d.pathname === here;
  return {
    range: own ? d.range : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    message: own ? d.message : `${d.pathname}: ${d.message}`,
    severity: d.severity === 'error' ? (1 as const) : (2 as const),
    source: 'markout',
  };
}

export function createMarkoutService(props: MarkoutServiceProps): LanguageServicePlugin {
  return {
    name: 'markout',
    capabilities: {
      /**
       * `interFileDependencies: false` is the load-bearing half of this,
       * and it does not mean what it says.
       *
       * A page's diagnostics plainly do depend on other files -- it imports
       * them. But Volar reads that flag as "this cannot be answered by
       * pulling", and answers by PUSHING instead: it publishes diagnostics
       * for open documents when they change, and advertises no diagnostic
       * provider at all. A client with nothing to pull from never asks about
       * a file it has not opened, which is why the Problems panel listed
       * only what was on screen.
       *
       * Declaring false turns the pull model on, workspace diagnostics with
       * it. What that model does not do by itself is notice that editing a
       * fragment changes the pages importing it -- so the server asks for a
       * refresh when any document changes, which is the same knowledge
       * arriving by the other door. See server.ts.
       */
      diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: true },
      definitionProvider: true,
      // `.` because `body.` is the moment the list is most worth having, and
      // is also the moment the expression stops being valid JavaScript
      completionProvider: { triggerCharacters: ['.', '<', ':'] },
      hoverProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
    },
    create(context) {
      /** the docroot a file is read against: the setting, or the guess */
      const docrootFor = (filePath: string) =>
        props.docroot ?? guessDocroot(filePath, folderOf(filePath, props.workspaceFolders));

      /**
       * The source file behind a virtual document, if this service owns it.
       *
       * A service is asked about every virtual document, not about the file:
       * Volar hands over `volar-embedded-content://<code id>/<the encoded
       * source uri>`. So the source has to be decoded back out -- and only
       * ONE of the embedded codes may answer, or the same compiler error
       * arrives once per embedded document.
       */
      const sourceOf = (uri: string, code: 'root' | 'html' = 'root') => {
        const decoded = context.decodeEmbeddedDocumentUri(URI.parse(uri));
        if (!decoded || decoded[1] !== code) {
          return undefined;
        }
        const source = decoded[0];
        return source.scheme === 'file' && isPage(source.path) ? source : undefined;
      };

      /** the props every one of these needs, from a virtual document */
      const ask = async (
        document: { uri: string; getText(): string; offsetAt(p: Position): number },
        position: Position
      ) => {
        const uri = sourceOf(document.uri);
        if (!uri) {
          return undefined;
        }
        const filePath = uri.fsPath;
        const docroot = docrootFor(filePath);
        return {
          docroot,
          props: {
            docroot,
            pathname: pathnameOf(filePath, docroot),
            text: document.getText(),
            offset: document.offsetAt(position),
            open: props.open,
          },
        };
      };

      return {
        /**
         * Completion is a list SEVERAL services contribute to, and Volar
         * lets the first one that answers claim the position -- every other
         * service is then skipped. Embedded documents are visited
         * innermost-first, so `volar-service-html` answers on the embedded
         * HTML before this service is reached on the root, and a markout
         * list would never appear at all.
         *
         * Saying the contribution is additional is what keeps both: an
         * additional provider does not claim the position, and is merged
         * with whoever did.
         */
        isAdditionalCompletion: true,

        /**
         * Ctrl-click on an `<:import src>` opens the file.
         *
         * Worth having even though the path looks obvious: half of them are
         * not. `/lib.htm` is docroot-relative rather than
         * file-relative, and `/npm/@markout-dev/bootstrap-kit/all.htm` is inside
         * an installed package -- neither is somewhere an editor would find
         * by guessing, and both are somewhere the compiler already knows.
         */
        async provideRenameRange(document, position) {
          const asked = await ask(document, position);
          if (!asked) {
            return undefined;
          }
          const found = await prepareRename(asked.props);
          // undefined refuses the rename, which is the right answer for a
          // word that names nothing the compiler knows about
          return found?.range;
        },

        async provideRenameEdits(document, position, newName) {
          const asked = await ask(document, position);
          if (!asked) {
            return undefined;
          }
          const edits = await renameEdits(asked.props);
          if (!edits.length) {
            return undefined;
          }
          const changes: Record<string, { range: typeof edits[0]['range']; newText: string }[]> = {};
          for (const edit of edits) {
            const uri = URI.file(nodePath.join(asked.docroot, edit.pathname)).toString();
            (changes[uri] ??= []).push({ range: edit.range, newText: newName });
          }
          return { changes };
        },

        async provideReferences(document, position, context) {
          const uri = sourceOf(document.uri);
          if (!uri) {
            return undefined;
          }
          const filePath = uri.fsPath;
          const docroot = docrootFor(filePath);
          const found = await findReferences({
            docroot,
            pathname: pathnameOf(filePath, docroot),
            text: document.getText(),
            offset: document.offsetAt(position),
            open: props.open,
            includeDeclaration: context.includeDeclaration,
          });
          return found.map(site => ({
            uri: URI.file(nodePath.join(docroot, site.pathname)).toString(),
            range: site.range,
          }));
        },

        async provideHover(document, position) {
          const uri = sourceOf(document.uri);
          if (!uri) {
            return undefined;
          }
          const filePath = uri.fsPath;
          const docroot = docrootFor(filePath);
          const found = await findHover({
            docroot,
            pathname: pathnameOf(filePath, docroot),
            text: document.getText(),
            offset: document.offsetAt(position),
            open: props.open,
          });
          return found ? { contents: { kind: 'markdown', value: found.markdown } } : undefined;
        },

        async provideCompletionItems(document, position) {
          // ...and being merged means answering on the document the claim
          // was made against, which is the embedded HTML rather than the
          // root. Its text is the page with the expressions masked, so the
          // buffer is read separately -- the mask is character for
          // character, which is what makes this offset the right one.
          const uri = sourceOf(document.uri, 'html');
          if (!uri) {
            return undefined;
          }
          const filePath = uri.fsPath;
          const text = props.open(filePath);
          if (text === undefined) {
            return undefined;
          }
          const docroot = docrootFor(filePath);
          const found = await findCompletions({
            docroot,
            pathname: pathnameOf(filePath, docroot),
            text,
            offset: document.offsetAt(position),
            open: props.open,
            filePath,
          });
          return {
            isIncomplete: false,
            items: found.map((item, i) => ({
              label: item.name,
              // Field for a value, Module for a scope: the distinction the
              // language makes, in the vocabulary an editor already draws
              kind: item.kind === 'value' ? 5 : 9,
              detail: item.detail,
              // `visibleFrom` answers nearest-first, and a list sorted
              // alphabetically would bury the values of the scope actually
              // asked about under everything visible from it
              sortText: String(i).padStart(4, '0'),
            })),
          };
        },

        async provideDefinition(document, position) {
          const uri = sourceOf(document.uri);
          if (!uri) {
            return undefined;
          }
          const text = document.getText();
          const offset = document.offsetAt(position);
          const filePath = uri.fsPath;
          const docroot = docrootFor(filePath);
          const pathname = pathnameOf(filePath, docroot);

          // a file a directive names
          const reference = fileReferenceAt(text, offset);
          if (reference) {
            const target = resolveReference({
              docroot,
              fromPathname: pathname,
              spec: reference.value,
            });
            if (!target) {
              // refused or outside the docroot: the diagnostic says so, and
              // opening something plausible instead would hide that
              return undefined;
            }
            const start = { line: 0, character: 0 };
            return [
              {
                targetUri: URI.file(target).toString(),
                targetRange: { start, end: start },
                targetSelectionRange: { start, end: start },
                // what the editor underlines: the path, not the tag round it
                originSelectionRange: {
                  start: document.positionAt(reference.start),
                  end: document.positionAt(reference.end),
                },
              },
            ];
          }

          // otherwise a name in an expression, which the compiler resolves
          const declaration = await findDeclaration({
            docroot,
            pathname,
            text,
            offset,
            open: props.open,
          });
          if (!declaration) {
            return undefined;
          }
          const file = fileOf(declaration, { docroot, from: pathname });
          if (!file) {
            return undefined;
          }
          return [
            {
              targetUri: URI.file(file).toString(),
              targetRange: declaration.range,
              // the point, not the extent: see Declaration.selection
              targetSelectionRange: declaration.selection,
            },
          ];
        },

        async provideWorkspaceDiagnostics() {
          const folders = props.workspaceFolders ?? [];
          if (!folders.length) {
            return [];
          }
          const { problems, checked, skipped } = await diagnoseWorkspace({
            workspaceFolders: folders,
            docroot: props.docroot,
            enable: props.enable,
            open: props.open,
            limit: props.limit,
          });
          if (skipped) {
            // A bound that is never mentioned reads as "nothing else is
            // wrong", which is the one thing it does not mean -- and it was
            // said to `console`, where the author of a page is not looking.
            // The editor's own warning is where they are.
            props.warn?.(
              `markout checked ${checked} pages of this workspace and stopped: ` +
                `${skipped} more are not reported on.`
            );
          }
          return problems.map(problem => ({
            uri: URI.file(problem.filePath).toString(),
            version: null,
            kind: 'full' as const,
            items: problem.diagnostics.map(d => asDiagnostic(d)),
          }));
        },

        async provideDiagnostics(document) {
          const uri = sourceOf(document.uri);
          if (!uri) {
            return [];
          }
          const filePath = uri.fsPath;
          const enable = props.enable ?? 'auto';
          if (enable === 'never') {
            return [];
          }
          const docroot = docrootFor(filePath);
          // This extension has no file suffix of its own to hide behind, so
          // it has to be shown evidence. Either will do, and the first is the
          // one that matters: a project that installs nothing and runs
          // `npx markout ./site` -- which is markout's whole delivery story --
          // has no package.json to be recognised by, and its pages have to
          // speak for themselves.
          if (enable === 'auto' && !looksLikeMarkout(document.getText()) && !isMarkoutProject(docroot)) {
            return [];
          }
          const pathname = pathnameOf(filePath, docroot);
          const found = await diagnose({
            docroot,
            pathname,
            text: document.getText(),
            open: props.open,
          });
          return found.map(d => asDiagnostic(d, pathname));
        },
      };
    },
  };
}
