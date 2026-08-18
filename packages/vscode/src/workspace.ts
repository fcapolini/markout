import path from 'path';
import fs from 'fs';
import {
  diagnose,
  guessDocroot,
  isMarkoutProject,
  looksLikeMarkout,
  type MarkoutDiagnostic,
} from './diagnostics';
import { pagesUnder } from './pages';

/**
 * Every problem in the project, not only in the files that happen to be open.
 *
 * The Problems panel is where somebody asks "is this project alright" before
 * a commit, and answering only about open editors makes it a panel about
 * what has been looked at. `markout build` has always known the whole answer;
 * this is that answer, without leaving the editor.
 *
 * Only PAGES are compiled. A fragment is not compiled on its own here and
 * does not need to be: compiling a page reports the faults of everything it
 * imports, attributed to the file they are in, so a broken fragment is
 * reported at its own line by whichever page pulled it in. That also means a
 * fragment nobody imports is not checked, which is the same thing `build`
 * says about it.
 */

export interface WorkspaceProblem {
  /** the file, absolutely, since a workspace spans docroots */
  filePath: string;
  diagnostics: MarkoutDiagnostic[];
}

export interface WorkspaceProps {
  workspaceFolder: string;
  /** an explicit docroot, from `markout.docroot`; guessed per file when absent */
  docroot?: string;
  enable?: 'auto' | 'always' | 'never';
  open?: (filePath: string) => string | undefined;
  /**
   * How many pages to compile before giving up.
   *
   * A bound rather than a promise: this walks a whole project, and a project
   * large enough to matter is one where an unbounded sweep would be felt.
   * What is skipped is reported rather than silently dropped.
   */
  limit?: number;
}

export async function diagnoseWorkspace(props: WorkspaceProps): Promise<{
  problems: WorkspaceProblem[];
  /** pages not compiled because the limit was reached */
  skipped: number;
}> {
  const limit = props.limit ?? 200;
  const enable = props.enable ?? 'auto';
  if (enable === 'never') {
    return { problems: [], skipped: 0 };
  }

  const found = new Map<string, Map<string, MarkoutDiagnostic>>();
  const files = pagesUnder(props.workspaceFolder);
  let compiled = 0;
  let skipped = 0;

  for (const file of files) {
    if (compiled >= limit) {
      // only what the LIMIT cost: a page the gate turned down is not
      // unchecked, it is a page this extension has no opinion about, and
      // counting it here would report a project as half-examined
      skipped++;
      continue;
    }
    const text = read(file, props.open);
    if (text === undefined) {
      continue;
    }
    const docroot = props.docroot ?? guessDocroot(file, props.workspaceFolder);
    if (enable === 'auto' && !looksLikeMarkout(text) && !isMarkoutProject(docroot)) {
      continue;
    }
    compiled++;
    const pathname = '/' + path.relative(docroot, file).split(path.sep).join('/');
    for (const diagnostic of await diagnose({ docroot, pathname, text, open: props.open })) {
      // the file the compiler blamed, which is often not the page compiled --
      // that is the whole reason a sweep over pages covers fragments too
      const blamed = path.join(docroot, diagnostic.pathname);
      const per = found.get(blamed) ?? new Map();
      // one page can be reached through several others; the same fault
      // reported twice is still one fault
      per.set(
        `${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.message}`,
        diagnostic
      );
      found.set(blamed, per);
    }
  }

  return {
    problems: [...found].map(([filePath, per]) => ({
      filePath,
      diagnostics: [...per.values()],
    })),
    skipped,
  };
}

function read(
  filePath: string,
  open?: (filePath: string) => string | undefined
): string | undefined {
  const buffer = open?.(filePath);
  if (buffer !== undefined) {
    return buffer;
  }
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}
