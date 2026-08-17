/**
 * The file references a page makes: `<:import src="…">` and
 * `<:include src="…">`.
 *
 * Only those two. A `<script src>` or an `<img src>` names something the
 * browser fetches at a URL, which the editor cannot follow to a file without
 * knowing how the site is deployed; a directive's `src` names a file the
 * COMPILER reads, resolved by the same resolver the server uses. Those are
 * different questions and only the second has an answer worth offering.
 */

export interface FileReference {
  /** the pathname as written, without its quotes */
  value: string;
  /** offset of the first character inside the quotes */
  start: number;
  /** offset just past the last character inside the quotes */
  end: number;
}

/** `<:import` / `<:include`, up to the `src` attribute's quoted value */
const DIRECTIVE_SRC =
  /<:(?:import|include)\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** every file a page's directives name, in order */
export function findFileReferences(text: string): FileReference[] {
  const found: FileReference[] = [];
  for (const match of text.matchAll(DIRECTIVE_SRC)) {
    const value = match[1] ?? match[2] ?? '';
    // the quoted value's own offsets, not the whole match's: what the editor
    // underlines has to be the path, not the tag around it
    const quoted = match[0].lastIndexOf(value);
    const start = match.index + quoted;
    found.push({ value, start, end: start + value.length });
  }
  return found;
}

/** the reference the offset is inside, if any */
export function fileReferenceAt(text: string, offset: number): FileReference | undefined {
  return findFileReferences(text).find(r => offset >= r.start && offset <= r.end);
}
