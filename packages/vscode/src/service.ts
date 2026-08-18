import type { LanguageServicePlugin } from '@volar/language-service';
import * as path from 'path';
import { URI } from 'vscode-uri';
import {
  diagnose,
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

/**
 * The compiler, as a language service.
 *
 * Thin on purpose: everything that is hard lives in ./diagnostics, which
 * knows nothing about Volar and is tested without it. What is here is the
 * two things that need the editor's own vocabulary — which URI is open, and
 * how a diagnostic for ANOTHER file gets reported against this one.
 */

export interface MarkoutServiceProps {
  /** the folder a file's docroot is looked for under */
  workspaceFolder?: string;
  /** an explicit docroot, from `markout.docroot`; guessed when absent */
  docroot?: string;
  /** `markout.enable`: whether a project has to look like markout's */
  enable?: 'auto' | 'always' | 'never';
  /** the editor's unsaved buffers, by file path */
  open: (filePath: string) => string | undefined;
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
  workspaceFolder?: string;
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
      const docroot = props.docroot ?? guessDocroot(filePath, props.workspaceFolder);
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

export function createMarkoutService(props: MarkoutServiceProps): LanguageServicePlugin {
  return {
    name: 'markout',
    capabilities: {
      diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
      definitionProvider: true,
      // `.` because `body.` is the moment the list is most worth having, and
      // is also the moment the expression stops being valid JavaScript
      completionProvider: { triggerCharacters: ['.'] },
    },
    create(context) {
      /**
       * The source file behind a virtual document, if this service owns it.
       *
       * A service is asked about every virtual document, not about the file:
       * Volar hands over `volar-embedded-content://<code id>/<the encoded
       * source uri>`. So the source has to be decoded back out -- and only
       * ONE of the embedded codes may answer, or the same compiler error
       * arrives once per embedded document.
       */
      const sourceOf = (uri: string) => {
        const decoded = context.decodeEmbeddedDocumentUri(URI.parse(uri));
        if (!decoded || decoded[1] !== 'root') {
          return undefined;
        }
        const source = decoded[0];
        return source.scheme === 'file' && isPage(source.path) ? source : undefined;
      };

      return {
        /**
         * Ctrl-click on an `<:import src>` opens the file.
         *
         * Worth having even though the path looks obvious: half of them are
         * not. `/lib.htm` is docroot-relative rather than
         * file-relative, and `/npm/@markout/bootstrap-kit/all.htm` is inside
         * an installed package -- neither is somewhere an editor would find
         * by guessing, and both are somewhere the compiler already knows.
         */
        async provideCompletionItems(document, position) {
          const uri = sourceOf(document.uri);
          if (!uri) {
            return undefined;
          }
          const filePath = uri.fsPath;
          const docroot = props.docroot ?? guessDocroot(filePath, props.workspaceFolder);
          const found = await findCompletions({
            docroot,
            pathname: pathnameOf(filePath, docroot),
            text: document.getText(),
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
          const docroot = props.docroot ?? guessDocroot(filePath, props.workspaceFolder);
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
          const docroot = props.docroot ?? guessDocroot(filePath, props.workspaceFolder);
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
          // a fragment is compiled by the pages that import it, not on its
          // own: on its own it has no scope chain to resolve against, and
          // every reference in it would be reported as unknown
          if (path.extname(filePath).toLowerCase() === '.htm') {
            return [];
          }

          const found = await diagnose({ docroot, pathname, open: props.open });
          return found.map(d => {
            const here = d.pathname === pathname;
            return {
              // an error inside an imported fragment still has to be visible
              // from the page that pulled it in, or a broken library reads
              // as a page that is fine. Reported at the top, named
              range: here
                ? d.range
                : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              message: here ? d.message : `${d.pathname}: ${d.message}`,
              severity: d.severity === 'error' ? 1 : 2,
              source: 'markout',
            };
          });
        },
      };
    },
  };
}
