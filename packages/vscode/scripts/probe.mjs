/**
 * Ask the BUILT language server what it answers for the fixture, and print it.
 *
 * `npm run probe -w markout-vscode`
 *
 * This exists because "it doesn't work in my editor" has two very different
 * causes -- a server that answers wrongly, and an editor talking to a server
 * from before the last build -- and no amount of clicking distinguishes
 * them. This talks to the same `dist/server.js` the extension loads, over
 * the same protocol, with nothing of VS Code in between. If the answers here
 * are right and the editor disagrees, the editor is holding an old process:
 * stop the debug session and start it again, which rebuilds on the way.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const server = path.join(pkg, 'dist', 'server.js');
const workspace = path.join(pkg, 'fixture');

if (!fs.existsSync(server)) {
  console.error(`no server at ${server} -- run "npm run build" first`);
  process.exit(1);
}

/** every question worth asking, as "the name in this text on this page" */
const CASES = [
  ['scopes.html', 'page', '${page.title}</title>'],
  ['scopes.html', 'head', '${head.charset}'],
  ['scopes.html', 'body', '${body.items}'],
  ['scopes.html', 'items', 'body.items', '.items'],
  ['scopes.html', 'item', '${item}</li>'],
  ['index.html', 'padding (in <style>)', '${padding}px'],
  ['lib.htm', 'title', '${title}</h2>'],
  ['lib.htm', 'tone', 'tone === '],
];

const child = spawn(process.execPath, [server, '--stdio'], { stdio: 'pipe' });
let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();

child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const header = buffer.indexOf('\r\n\r\n');
    if (header < 0) return;
    const match = /Content-Length: (\d+)/i.exec(buffer.subarray(0, header).toString());
    if (!match) return;
    const start = header + 4;
    const length = Number(match[1]);
    if (buffer.length < start + length) return;
    const message = JSON.parse(buffer.subarray(start, start + length).toString());
    buffer = buffer.subarray(start + length);
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  }
});

const send = body => {
  const text = JSON.stringify({ jsonrpc: '2.0', ...body });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
};
const request = (method, params) =>
  new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    send({ id, method, params });
  });

await request('initialize', {
  processId: process.pid,
  rootUri: `file://${workspace}`,
  workspaceFolders: [{ uri: `file://${workspace}`, name: 'fixture' }],
  capabilities: {
    textDocument: {
      definition: { linkSupport: true },
      diagnostic: { dynamicRegistration: false },
      documentLink: { dynamicRegistration: false },
    },
  },
});
send({ method: 'initialized', params: {} });

const opened = new Map();
function open(name) {
  if (opened.has(name)) return opened.get(name);
  const file = path.join(workspace, 'markout', name);
  const text = fs.readFileSync(file, 'utf8');
  const uri = `file://${file}`;
  send({
    method: 'textDocument/didOpen',
    params: { textDocument: { uri, languageId: 'html', version: 1, text } },
  });
  const doc = { uri, text, lines: text.split('\n') };
  opened.set(name, doc);
  return doc;
}

/** the position of the first letter at (or after) `needle`, optionally at `within` */
function positionOf(doc, needle, within) {
  let at = doc.text.indexOf(needle);
  if (at < 0) return undefined;
  if (within) at = doc.text.indexOf(within, at);
  // to the first LETTER: `$` is an identifier character, so scanning for one
  // stops on the `$` of `${` and lands the cursor on the brace
  while (at < doc.text.length && !/[A-Za-z_]/.test(doc.text[at])) at++;
  return {
    line: doc.text.slice(0, at).split('\n').length - 1,
    character: at - (doc.text.lastIndexOf('\n', at - 1) + 1),
  };
}

console.log('go to definition\n');
for (const [name, label, needle, within] of CASES) {
  const doc = open(name);
  const position = positionOf(doc, needle, within);
  if (!position) {
    console.log(`  ${`${name} ${label}`.padEnd(34)} (not in the fixture)`);
    continue;
  }
  const found = await request('textDocument/definition', {
    textDocument: { uri: doc.uri },
    position,
  });
  const target = found?.[0];
  const where = target
    ? `${path.basename(target.targetUri)}:${target.targetRange.start.line + 1}`
    : 'NOTHING';
  const line = target?.targetUri.endsWith(name)
    ? doc.lines[target.targetRange.start.line].trim().slice(0, 44)
    : '';
  console.log(`  ${`${name} ${label}`.padEnd(34)} -> ${where.padEnd(16)} ${line}`);
}

console.log('\ndiagnostics\n');
for (const name of ['index.html', 'broken.html', 'missing.html', 'plain.html']) {
  const doc = open(name);
  const report = await request('textDocument/diagnostic', {
    textDocument: { uri: doc.uri },
  });
  const items = report?.items ?? [];
  console.log(`  ${name.padEnd(16)} ${items.length ? '' : '(clean)'}`);
  items.forEach(i => console.log(`     line ${i.range.start.line + 1}: ${i.message}`));
}

child.kill();
process.exit(0);
