import type { LanguageServicePlugin } from '@volar/language-service';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { diagnose, guessDocroot, isMarkoutProject, pathnameOf } from './diagnostics';
import { isPage } from './plugin';

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
    },
    create(context) {
      return {
        async provideDiagnostics(document) {
          // A service is asked about every virtual document, not about the
          // file: Volar hands over `volar-embedded-content://<code id>/<the
          // encoded source uri>`. So the source has to be decoded back out,
          // and only ONE of the embedded codes may answer -- otherwise the
          // same compiler error is reported once per embedded document.
          const decoded = context.decodeEmbeddedDocumentUri(URI.parse(document.uri));
          if (!decoded || decoded[1] !== 'root') {
            return [];
          }
          const uri = decoded[0];
          if (uri.scheme !== 'file' || !isPage(uri.path)) {
            return [];
          }
          const filePath = uri.fsPath;
          const enable = props.enable ?? 'auto';
          if (enable === 'never') {
            return [];
          }
          const docroot = props.docroot ?? guessDocroot(filePath, props.workspaceFolder);
          // this extension has no file suffix of its own to hide behind, so
          // the question is about the project rather than the file
          if (enable === 'auto' && !isMarkoutProject(docroot)) {
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
