import fs from 'fs';
import path from 'path';
import { findDeclaration, type Declaration } from './declarations';
import type { Range } from './diagnostics';

/**
 * What the thing under the cursor is, without going anywhere.
 *
 * The same question go-to-definition answers, asked by someone who does not
 * want to leave the page -- which is most of the time, and is why this is
 * worth having even though it adds no knowledge. It shows the declaration
 * itself: the line that declares a name, the `<:define>` line for a tag, the
 * `:param=` for a parameter.
 *
 * Reading the declaring line rather than describing it is deliberate. A
 * summary would be a second thing to keep true; the source cannot go stale.
 */

export interface Hover {
  /** markdown, as an editor renders it */
  markdown: string;
  /** what the hover is about, so the editor underlines the right word */
  range?: Range;
}

export interface HoverProps {
  docroot: string;
  pathname: string;
  text: string;
  offset: number;
  open?: (filePath: string) => string | undefined;
}

export async function findHover(props: HoverProps): Promise<Hover | undefined> {
  const declaration = await findDeclaration(props);
  if (!declaration) {
    return undefined;
  }
  const line = declaringLine(declaration, props);
  const where = `${declaration.pathname}:${declaration.range.start.line + 1}`;
  return {
    markdown: line
      ? ['```html', line, '```', '', `*declared in* \`${where}\``].join('\n')
      : `*declared in* \`${where}\``,
  };
}

/**
 * The line a declaration sits on, from whichever file it is in.
 *
 * The file may be the one being edited, in which case the buffer is what to
 * read -- an author who has just typed a parameter should see it, not the
 * version last saved.
 */
function declaringLine(declaration: Declaration, props: HoverProps): string | undefined {
  const text =
    declaration.pathname === props.pathname
      ? props.text
      : readFile(path.join(props.docroot, declaration.pathname), props.open);
  if (text === undefined) {
    return undefined;
  }
  const line = text.split('\n')[declaration.range.start.line];
  return line === undefined ? undefined : line.trim() || undefined;
}

function readFile(
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
