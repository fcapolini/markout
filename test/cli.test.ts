import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'src/index.ts');
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const execFileAsync = promisify(execFile);

let child: ChildProcess | undefined;

async function availablePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    probe.close(error => (error ? reject(error) : resolve()));
  });
  return port;
}

/**
 * Runs until every one of `texts` has been printed, then hands back
 * everything printed so far.
 *
 * All of them, rather than one readiness marker, because what comes back is
 * a SNAPSHOT: resolving on the address line and then asserting about another
 * line was a race the server's log order happened to lose about one run in
 * five. The server now prints the address last for that reason, and waiting
 * on each string the caller cares about is what keeps this from depending on
 * that staying true.
 */
async function waitForOutput(
  process: ChildProcess,
  texts: string | string[]
): Promise<string> {
  const wanted = Array.isArray(texts) ? texts : [texts];
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (wanted.every(text => output.includes(text))) {
        resolve(output);
      }
    };
    process.stdout?.on('data', onData);
    process.stderr?.on('data', onData);
    process.once('error', reject);
    process.once('exit', code => {
      reject(new Error(`CLI exited with code ${code}: ${output}`));
    });
  });
}

afterEach(async () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  child = undefined;
});

describe('CLI', () => {
  it('shows help when no arguments are supplied', async () => {
    const result = await execFileAsync(process.execPath, [tsx, entry], {
      cwd: root,
    });

    expect(result.stdout).toContain('Usage: markout [options] <pathname>');
    expect(result.stdout).toContain('Options:');
    expect(result.stdout).not.toContain("error: missing required argument 'pathname'");
  });

  it('supports short and long help options', async () => {
    for (const option of ['-h', '--help']) {
      const result = await execFileAsync(process.execPath, [tsx, entry, option], {
        cwd: root,
      });

      expect(result.stdout).toContain('Usage: markout [options] <pathname>');
      expect(result.stdout).toContain('path to directory containing HTML files');
      expect(result.stdout).not.toContain('serve [options]');
    }
  });

  it('serves the supplied docroot without a serve subcommand', async () => {
    const docroot = await mkdtemp(path.join(root, '.cli-test-'));
    const pathname = path.relative(root, docroot);
    const port = await availablePort();
    await writeFile(
      path.join(docroot, 'index.html'),
      '<html><body>CLI works</body></html>'
    );

    try {
      child = spawn(process.execPath, [tsx, entry, pathname, '--port', `${port}`], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const output = await waitForOutput(child, `127.0.0.1:${port}/`);
      const response = await fetch(`http://127.0.0.1:${port}/index.html`);

      expect(output).toContain(`docroot ${docroot}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('CLI works');
    } finally {
      await rm(docroot, { recursive: true, force: true });
    }
  });

  it('compresses responses with --compress', async () => {
    const docroot = await mkdtemp(path.join(root, '.cli-test-'));
    const pathname = path.relative(root, docroot);
    const port = await availablePort();
    // above compression's 1kb default threshold
    const filler = 'compressible body. '.repeat(100);
    await writeFile(
      path.join(docroot, 'index.html'),
      `<html><body>${filler}</body></html>`
    );

    try {
      child = spawn(
        process.execPath,
        [tsx, entry, pathname, '--port', `${port}`, '--compress'],
        { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const output = await waitForOutput(child, [
        `127.0.0.1:${port}/`,
        'compression enabled',
      ]);
      const response = await fetch(`http://127.0.0.1:${port}/index.html`, {
        headers: { 'Accept-Encoding': 'gzip' },
      });

      expect(output).toContain('compression enabled');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-encoding')).toBe('gzip');
      expect(await response.text()).toContain('compressible body.');
    } finally {
      await rm(docroot, { recursive: true, force: true });
    }
  });
});