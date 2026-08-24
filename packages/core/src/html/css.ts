/**
 * A `style` attribute's declarations, as property/value pairs.
 *
 * A scanner rather than two `split`s, because both separators occur INSIDE
 * values and splitting on them loses the declaration without saying so. What
 * used to happen, with nothing reported:
 *
 *     background: url(data:image/svg+xml;base64,PHN2)   -> dropped entirely
 *     content: "; "                                     -> truncated to `"`
 *
 * The first is a data URI, which holds both separators and is the ordinary
 * way to inline an icon; the second is any quoted value carrying one. Neither
 * has a `${...}` or a `:` anywhere near it, so both were plain HTML that did
 * not survive being read -- and where the style is reactive it was worse than
 * lost, since the browser's own CSSOM keeps what the server dropped and the
 * two sides then render differently.
 *
 * So: `;` and `:` count only at paren depth zero and outside quotes, and only
 * the FIRST `:` of a declaration splits it -- `background: url(http://x)` has
 * three colons and one property name.
 */
export function parseDeclarations(s: string): [string, string][] {
  const ret: [string, string][] = [];
  let depth = 0;
  let quote = '';
  let colon = -1;
  let start = 0;
  const decl = (end: number) => {
    if (colon < 0) return;
    const key = s.slice(start, colon).trim();
    const val = s.slice(colon + 1, end).trim();
    key && val && ret.push([key, val]);
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      // a backslash escapes the next character, quote included: CSS strings
      // are escaped the way JS ones are, and `content: "\""` is one value
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth > 0 && depth--;
    else if (depth === 0 && c === ':' && colon < 0) colon = i;
    else if (depth === 0 && c === ';') {
      decl(i);
      colon = -1;
      start = i + 1;
    }
  }
  decl(s.length);
  return ret;
}
