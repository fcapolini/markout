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

export function createMarkoutService(props: MarkoutServiceProps): LanguageServicePlugin {
  return {
    name: 'markout',
    capabilities: {
      diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
      definitionProvider: true,
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
        provideDefinition(document, position) {
          const uri = sourceOf(document.uri);
          if (!uri) {
            return undefined;
          }
          const text = document.getText();
          const reference = fileReferenceAt(text, document.offsetAt(position));
          if (!reference) {
            return undefined;
          }
          const filePath = uri.fsPath;
          const docroot = props.docroot ?? guessDocroot(filePath, props.workspaceFolder);
          const target = resolveReference({
            docroot,
            fromPathname: pathnameOf(filePath, docroot),
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
