/**
 * Ask the EDITOR'S OWN tokenizer what colour it gives a markout page.
 *
 *     npm run tokens -w markout-vscode                  every page in the repo
 *     npm run tokens -w markout-vscode -- <file>        one file, token by token
 *     npm run tokens -w markout-vscode -- <file> --all  ...including HTML's
 *
 * The grammars are injections: they do not run on their own, they run inside
 * VS Code's HTML grammar, and what they are worth depends entirely on what
 * that grammar was going to do at the same position. Nothing in a
 * `.tmLanguage.json` says so, and nothing in this package's tests reads one,
 * so a change to a regex here is otherwise checked by opening a file and
 * looking at it -- which sees one page, in one theme, at one cursor.
 *
 * This runs the real thing: vscode-textmate, over VS Code's own installed
 * grammars, over the pages in this repository. It is probe.mjs's sibling, for
 * the same reason -- what the editor does is a question with a real answer,
 * and squinting is not how to get it.
 *
 * The signal, with no file named, is `invalid.illegal.character-not-allowed-
 * here.html`: the scope HTML gives a character it has no rule for, which is
 * every character of markout's own syntax it does not understand. It is both
 * the bug report and the regression check, so a non-empty count exits 1.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require_ = createRequire(import.meta.url);
const oniguruma = require_('vscode-oniguruma');
const tm = require_('vscode-textmate');

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const repo = path.resolve(pkg, '../..');
const syntaxes = path.join(pkg, 'syntaxes');

/** the scope HTML gives what it cannot account for, which is what we fix */
const ILLEGAL = 'invalid.illegal.character-not-allowed-here';

/**
 * VS Code's grammars, from VS Code.
 *
 * Read from the installed editor rather than vendored or downloaded: the
 * question this script answers is what the user's editor does, and a copy
 * of the HTML grammar taken at some point is an answer about a different
 * editor than the one on this machine.
 */
const APPS = [
  process.env.MARKOUT_VSCODE_APP,
  '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions',
  '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions',
  '/Applications/VSCodium.app/Contents/Resources/app/extensions',
  '/Applications/Cursor.app/Contents/Resources/app/extensions',
  '/usr/share/code/resources/app/extensions',
  '/usr/lib/code/extensions',
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/resources/app/extensions'),
].filter(Boolean);

const WANTED = {
  'text.html.basic': 'html/syntaxes/html.tmLanguage.json',
  'text.html.derivative': 'html/syntaxes/html-derivative.tmLanguage.json',
  'source.js': 'javascript/syntaxes/JavaScript.tmLanguage.json',
  'source.css': 'css/syntaxes/css.tmLanguage.json',
};

const extensions = APPS.find(dir => fs.existsSync(path.join(dir, WANTED['text.html.basic'])));
if (!extensions) {
  console.error(
    'no VS Code grammars found. Install VS Code, or point MARKOUT_VSCODE_APP at\n' +
      'the `resources/app/extensions` directory of an install of it.'
  );
  process.exit(2);
}

/** ours, whatever the package happens to contribute today */
const injections = [];
const files = {};
for (const [scope, rel] of Object.entries(WANTED)) {
  files[scope] = path.join(extensions, rel);
}
for (const name of fs.readdirSync(syntaxes)) {
  const file = path.join(syntaxes, name);
  const scope = JSON.parse(fs.readFileSync(file, 'utf8')).scopeName;
  files[scope] = file;
  injections.push(scope);
}

await oniguruma.loadWASM(
  fs.readFileSync(require_.resolve('vscode-oniguruma/release/onig.wasm')).buffer
);

const registry = new tm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: sources => new oniguruma.OnigScanner(sources),
    createOnigString: s => new oniguruma.OnigString(s),
  }),
  loadGrammar: async scope => {
    const file = files[scope];
    return file ? tm.parseRawGrammar(fs.readFileSync(file, 'utf8'), file) : null;
  },
  // the extension's `injectTo`, said to the tokenizer: without this the
  // grammars are loaded and never consulted, and every page comes back the
  // colour it was before markout existed
  getInjections: scope =>
    scope === 'text.html.basic' || scope === 'text.html.derivative' ? injections : undefined,
});

const grammar = await registry.loadGrammar('text.html.basic');

/** every token of a file, as { text, scopes, line } */
function tokenize(file) {
  const found = [];
  let stack = tm.INITIAL;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const [number, line] of lines.entries()) {
    const result = grammar.tokenizeLine(line, stack);
    for (const token of result.tokens) {
      const text = line.substring(token.startIndex, token.endIndex);
      if (text.trim()) {
        found.push({ text, scopes: token.scopes, line: number + 1, at: token.startIndex });
      }
    }
    stack = result.ruleStack;
  }
  return found;
}

const [asked, ...flags] = process.argv.slice(2);

if (asked) {
  // one file, which is the "why is this the wrong colour" question
  const file = path.resolve(asked);
  const all = flags.includes('--all');
  for (const token of tokenize(file)) {
    const ours = token.scopes.some(s => s.includes('markout') || s.startsWith('invalid'));
    if (!ours && !all) {
      continue;
    }
    const where = `${token.line}:${token.at + 1}`.padEnd(9);
    console.log(`  ${where} ${JSON.stringify(token.text).padEnd(28)} ${token.scopes.join(' ')}`);
  }
  process.exit(0);
}

// every page in the repository, which is the regression check
const PLACES = ['packages/vscode/fixture', 'kits', 'sites'];
let total = 0;
for (const place of PLACES) {
  for (const file of pagesUnder(path.join(repo, place))) {
    const bad = tokenize(file).filter(token => token.scopes.some(s => s.startsWith(ILLEGAL)));
    total += bad.length;
    if (bad.length) {
      console.log(`${path.relative(repo, file)}`);
      for (const token of bad.slice(0, 8)) {
        console.log(`  ${token.line}:${token.at + 1} ${JSON.stringify(token.text)}`);
      }
      if (bad.length > 8) {
        console.log(`  ... and ${bad.length - 8} more`);
      }
    }
  }
}

console.log(
  total === 0
    ? `\nnothing HTML calls illegal, in any page of this repository`
    : `\n${total} character(s) HTML has no rule for -- markout syntax it is painting as an error`
);
process.exit(total === 0 ? 0 : 1);

function pagesUnder(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...pagesUnder(full));
    } else if (/\.html?$|\.htm$/i.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}
