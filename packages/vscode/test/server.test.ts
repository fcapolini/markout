import { execSync, spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The language server, spoken to the way an editor speaks to it.
 *
 * Everything else in this package is tested in pieces, which is where the
 * bugs that matter are -- but not the ones that matter MOST. A plugin that
 * is never registered, a service whose capability is not announced, a
 * `main` pointing at a file that is not built: each leaves every unit test
 * green and the extension doing nothing at all. So this one starts the real
 * server over stdio and asks it a question.
 */

const PACKAGE = path.resolve(__dirname, '..');
const SERVER = path.join(PACKAGE, 'dist', 'server.js');

let docroot: string;
let child: ChildProcess;
let nextId = 1;
const pending = new Map<number, (result: unknown) => void>();

function send(message: object) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  child.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function request(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    send({ id, method, params });
  });
}

function notify(method: string, params: unknown) {
  send({ method, params });
}

/** the LSP framing: Content-Length, a blank line, then that many bytes */
function readMessages(buffer: { data: Buffer }, onMessage: (m: any) => void) {
  for (;;) {
    const header = buffer.data.indexOf('\r\n\r\n');
    if (header < 0) return;
    const match = /Content-Length: (\d+)/i.exec(buffer.data.subarray(0, header).toString());
    if (!match) return;
    const length = Number(match[1]);
    const start = header + 4;
    if (buffer.data.length < start + length) return;
    onMessage(JSON.parse(buffer.data.subarray(start, start + length).toString()));
    buffer.data = buffer.data.subarray(start + length);
  }
}

beforeAll(async () => {
  // the server under test is the BUILT one, which is also what the extension
  // loads -- a stale dist here would be a test of the previous commit
  execSync('npx tsc -b', { cwd: PACKAGE, stdio: 'ignore' });
  expect(fs.existsSync(SERVER)).toBe(true);

  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-lsp-server-'));
  // a project that uses markout, which is what turns the extension on: it
  // claims no file suffix of its own, so this is the only thing separating a
  // markout page from anybody else's HTML
  fs.writeFileSync(
    path.join(docroot, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: { markout: '^0.4.0' } })
  );
  // a docroot BELOW the workspace folder, which is the arrangement that
  // catches a link resolved against the wrong root
  fs.mkdirSync(path.join(docroot, 'markout'));
  fs.writeFileSync(path.join(docroot, 'markout/lib.htm'), '<lib></lib>');

  // and a project next door that has never heard of it
  fs.mkdirSync(path.join(docroot, 'other'));
  fs.writeFileSync(
    path.join(docroot, 'other/package.json'),
    JSON.stringify({ name: 'other', dependencies: { express: '^5.0.0' } })
  );

  child = spawn(process.execPath, [SERVER, '--stdio'], { stdio: 'pipe' });
  const buffer = { data: Buffer.alloc(0) };
  child.stdout!.on('data', chunk => {
    buffer.data = Buffer.concat([buffer.data, chunk]);
    readMessages(buffer, message => {
      const resolve = message.id !== undefined ? pending.get(message.id) : undefined;
      if (resolve) {
        pending.delete(message.id);
        resolve(message.result);
      }
    });
  });

  const result = await request('initialize', {
    processId: process.pid,
    rootUri: `file://${docroot}`,
    workspaceFolders: [{ uri: `file://${docroot}`, name: 'fixture' }],
    // pull diagnostics, which is what an editor asks for and what the
    // server only turns on when the client says it understands them
    capabilities: {
      textDocument: {
        diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
        // without this the server is obliged to downgrade every LocationLink
        // to a plain Location, and the origin range -- what gets underlined
        // under the cursor -- is dropped. VS Code advertises it; so must a
        // harness claiming to stand in for one
        definition: { linkSupport: true },
        documentLink: { dynamicRegistration: false },
      },
    },
  });
  expect(result.capabilities).toBeTruthy();
  notify('initialized', {});
}, 120000);

afterAll(() => {
  child?.kill();
  fs.rmSync(docroot, { recursive: true, force: true });
});

/** open a page with the given text and ask what is wrong with it */
async function diagnosticsFor(name: string, text: string) {
  const uri = `file://${path.join(docroot, name)}`;
  notify('textDocument/didOpen', {
    // `html`, which is what VS Code sends: this extension contributes no
    // language of its own, so as not to displace HTML's
    textDocument: { uri, languageId: 'html', version: 1, text },
  });
  const report = await request('textDocument/diagnostic', { textDocument: { uri } });
  return (report?.items ?? []) as { message: string; range: any; source?: string }[];
}

/** ask for the definition at a position, the way ctrl-click does */
async function definitionAt(name: string, text: string, at: string) {
  const uri = `file://${path.join(docroot, name)}`;
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'html', version: 1, text },
  });
  const before = text.indexOf(at);
  const line = text.slice(0, before).split('\n').length - 1;
  const character = before - (text.lastIndexOf('\n', before - 1) + 1);
  return (await request('textDocument/definition', {
    textDocument: { uri },
    position: { line, character },
  })) as { targetUri: string }[] | null;
}

/** the links the editor would offer, which is what ctrl-click follows */
async function documentLinksFor(name: string, text: string) {
  const uri = `file://${path.join(docroot, name)}`;
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'html', version: 1, text },
  });
  return ((await request('textDocument/documentLink', { textDocument: { uri } })) ??
    []) as { target?: string; range: any }[];
}

describe('the server, over stdio', () => {
  it('says nothing about a page that is fine', async () => {
    const found = await diagnosticsFor('ok.html', '<html :n=${21}><body>${n * 2}</body></html>');
    expect(found).toStrictEqual([]);
  });

  it('reports the compiler\'s error, on the right line', async () => {
    const found = await diagnosticsFor(
      'broken.html',
      ['<html>', '  <body>', '    ${nope}', '  </body>', '</html>'].join('\n')
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/nope/);
    expect(found[0].source).toBe('markout');
    expect(found[0].range.start.line).toBe(2);
  });

  it('says nothing at all in a project that is not markout\'s', async () => {
    // the same page that produces an error above. A `.html` file holding
    // `${…}` is JSP EL or Thymeleaf far more often than it is a markout
    // page, and this extension does not get to assume otherwise
    const found = await diagnosticsFor(
      'other/broken.html',
      ['<html>', '  <body>', '    ${nope}', '  </body>', '</html>'].join('\n')
    );
    expect(found).toStrictEqual([]);
  });

  it('follows an import to the file it names', async () => {
    fs.writeFileSync(path.join(docroot, 'lib.htm'), '<lib></lib>');
    const found = await definitionAt(
      'nav.html',
      '<html><head><:import src="/lib.htm" /></head><body>${x}</body></html>',
      '/lib.htm'
    );
    expect(found).toHaveLength(1);
    expect(found![0].targetUri).toContain('lib.htm');
  });

  it('offers a link that OPENS, where an editor would resolve one that does not', async () => {
    // the reported bug: VS Code prefers a document link over go-to-definition
    // on ctrl-click, and the HTML service resolves `/lib.htm` against the
    // workspace folder. Here the docroot is a directory below it, so that
    // default names a file which does not exist -- "Unable to open 'lib.htm'"
    const links = await documentLinksFor(
      'markout/page.html',
      '<html><head><:import src="/lib.htm" /></head><body>${x}</body></html>'
    );
    const targets = links.map(l => l.target);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toContain('/markout/lib.htm');
    // and the file it names is really there, which is the whole complaint
    expect(fs.existsSync(decodeURIComponent(targets[0]!.replace('file://', '')))).toBe(true);
  });

  it('offers nothing where there is nothing to follow', async () => {
    const found = await definitionAt(
      'plain.html',
      '<html><body :n=${1}>${n}</body></html>',
      '${n}'
    );
    expect(found === null || found.length === 0).toBe(true);
  });

  it('answers HTML\'s own questions too, through the embedded code', async () => {
    // volar-service-html over the masked HTML: proof that the second service
    // sees valid markup at the author's offsets, not a page cut in half by a
    // `>` inside an expression
    const uri = `file://${path.join(docroot, 'folds.html')}`;
    notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'html',
        version: 1,
        text: '<html>\n<body :hidden=${a > b}>\n<div>\n<p>x</p>\n</div>\n</body>\n</html>',
      },
    });
    const ranges = (await request('textDocument/foldingRange', {
      textDocument: { uri },
    })) as { startLine: number; endLine: number }[] | null;
    expect(ranges?.length).toBeGreaterThan(0);
    // the <div> on line 2 folds to line 4, which it only can if the `>` in
    // the expression above did not end the tag and swallow the rest
    expect(ranges).toContainEqual(expect.objectContaining({ startLine: 2, endLine: 3 }));
  });

  it('reports the buffer it was sent, not the file on disk', async () => {
    // there is no file at all: the page exists only as an open document,
    // which is the state an editor is in for most of a page's life
    const found = await diagnosticsFor('never-saved.html', '<html><body>${ghost}</body></html>');
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/ghost/);
    expect(fs.existsSync(path.join(docroot, 'never-saved.html'))).toBe(false);
  });
});
