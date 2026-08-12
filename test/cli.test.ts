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

async function waitForOutput(process: ChildProcess, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(text)) {
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
});