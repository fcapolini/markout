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

  it('reports the buffer it was sent, not the file on disk', async () => {
    // there is no file at all: the page exists only as an open document,
    // which is the state an editor is in for most of a page's life
    const found = await diagnosticsFor('never-saved.html', '<html><body>${ghost}</body></html>');
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/ghost/);
    expect(fs.existsSync(path.join(docroot, 'never-saved.html'))).toBe(false);
  });
});
