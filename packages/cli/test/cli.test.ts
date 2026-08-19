import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'src/cli.ts');

/**
 * tsx's own entry point, found the way node would.
 *
 * Not `<root>/node_modules/...`: in a workspace, npm hoists dependencies to
 * the workspace root, so this package's `node_modules` may not have tsx in it
 * at all -- and may, on a version conflict, be exactly where it does live.
 * Walking up covers both without asserting which one happened.
 */
function resolveTsx(): string {
  const rel = 'node_modules/tsx/dist/cli.mjs';
  for (let dir = root; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, rel);
    if (existsSync(candidate)) return candidate;
    if (dir === path.dirname(dir)) throw new Error(`cannot find ${rel}`);
  }
}

const tsx = resolveTsx();
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
  it('shows help when no arguments are supplied and there is no ./markout', async () => {
    const result = await execFileAsync(process.execPath, [tsx, entry], {
      cwd: root,
    });

    expect(result.stdout).toContain('Usage: markout [options] [command] [pathname]');
    expect(result.stdout).toContain('Options:');
    expect(result.stdout).not.toContain("error: missing required argument 'pathname'");
  });

  it('supports short and long help options', async () => {
    for (const option of ['-h', '--help']) {
      const result = await execFileAsync(process.execPath, [tsx, entry, option], {
        cwd: root,
      });

      expect(result.stdout).toContain('Usage: markout [options] [command] [pathname]');
      // commander wraps, so the default is matched across a line break
      expect(result.stdout).toMatch(/defaults to\s+\.\/markout/);
      // `build` is a command; serving is what the bare docroot does, and the
      // command list is where a `serve` would show up if that ever changed
      expect(result.stdout).toContain('build [options] [pathname] [outdir]');
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

  it('serves ./markout when nothing is named', async () => {
    // the convention, and the whole no-install delivery mode: a folder of
    // pages and `markout`. The editor support reads the same name to find a
    // docroot when there is no package.json -- see docs/design/editor-support.md
    const cwd = await mkdtemp(path.join(root, '.cli-default-'));
    const port = await availablePort();
    await mkdir(path.join(cwd, 'markout'));
    await writeFile(
      path.join(cwd, 'markout', 'index.html'),
      '<html><body>from the default docroot</body></html>'
    );

    try {
      child = spawn(process.execPath, [tsx, entry, '--port', `${port}`], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const output = await waitForOutput(child, `127.0.0.1:${port}/`);
      const response = await fetch(`http://127.0.0.1:${port}/index.html`);

      expect(output).toContain(path.join(cwd, 'markout'));
      expect(await response.text()).toContain('from the default docroot');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('shows help rather than guessing when ./markout is not there', async () => {
    // a directory that is not a markout project must not have one invented
    // for it: `.` would serve node_modules and .git, and an error would be
    // unhelpful to somebody who typed the bare name to find out what it is
    const cwd = await mkdtemp(path.join(root, '.cli-nodefault-'));
    try {
      const result = await execFileAsync(process.execPath, [tsx, entry], { cwd });
      expect(result.stdout).toContain('Usage: markout');
      expect(result.stdout).toMatch(/defaults to\s+\.\/markout/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('builds ./markout into a sibling ./dist with no arguments at all', async () => {
    // the other half of the convention. Beside the docroot rather than
    // inside it, because a build refuses an outdir under the docroot -- the
    // next run would compile its own output -- so a sibling is the only
    // default that cannot be refused
    const cwd = await mkdtemp(path.join(root, '.cli-buildnone-'));
    await mkdir(path.join(cwd, 'markout'));
    await writeFile(
      path.join(cwd, 'markout', 'index.html'),
      '<html :who=${\'world\'}><body>hi ${who}</body></html>'
    );

    try {
      const result = await execFileAsync(process.execPath, [tsx, entry, 'build'], { cwd });
      expect(result.stdout).toContain('1 page(s)');
      // and it does not claim a restriction nobody asked for
      expect(result.stdout).not.toContain('restricted to named pages');
      const built = await readFile(path.join(cwd, 'dist', 'index.html'), 'utf8');
      expect(built).toContain('hi ');
      expect(built).toContain('world');
      expect(existsSync(path.join(cwd, 'dist', 'markout-runtime.js'))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
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

describe('CLI build', () => {
  /** a docroot and an outdir beside it, never nested -- `build` refuses that */
  async function dirs() {
    const docroot = await mkdtemp(path.join(root, '.cli-build-src-'));
    const outdir = await mkdtemp(path.join(root, '.cli-build-out-'));
    return {
      docroot,
      outdir,
      cleanup: () =>
        Promise.all([
          rm(docroot, { recursive: true, force: true }),
          rm(outdir, { recursive: true, force: true }),
        ]),
    };
  }

  /** execFile rejects on a non-zero exit, so both outcomes come back the same shape */
  async function run(args: string[]) {
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [tsx, entry, 'build', ...args],
        { cwd: root }
      );
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }

  it('writes a rendered page and the runtime it points at', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      await writeFile(
        path.join(docroot, 'index.html'),
        '<html :n=${21}><body><p>${n * 2}</p></body></html>'
      );

      const result = await run([docroot, outdir]);
      const html = await readFile(path.join(outdir, 'index.html'), 'utf8');

      expect(result.code).toBe(0);
      // the value is RESOLVED in the file: a built page carries its markup
      // rather than waiting for the runtime to produce it
      expect(html).toContain('42');
      expect(html).toMatch(/^<!doctype html>/);
      // a non-dot path, which is why DEFAULT_RUNTIME_SRC is not dot-prefixed
      // any more: static hosts drop dotfiles, so the runtime would 404 on
      // every page of exactly the hosts this mode exists for
      expect(html).toContain('src="/markout-runtime.js"');
      expect((await readFile(path.join(outdir, 'markout-runtime.js'), 'utf8')).length)
        .toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  it('copies assets but not `.htm` fragments', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      await writeFile(
        path.join(docroot, 'lib.htm'),
        '<lib><:define tag="my-x:span">x</:define></lib>'
      );
      await writeFile(path.join(docroot, 'site.css'), 'body { color: red }');
      await writeFile(
        path.join(docroot, 'index.html'),
        '<html><head><:import src="/lib.htm" /></head><body><my-x /></body></html>'
      );

      const result = await run([docroot, outdir]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('.css');
      await expect(readFile(path.join(outdir, 'site.css'), 'utf8')).resolves.toContain('red');
      // a fragment is source: its content reached the output inlined into the
      // page that imported it, and the served mode answers 404 for the file
      await expect(readFile(path.join(outdir, 'lib.htm'), 'utf8')).rejects.toThrow();
      expect(await readFile(path.join(outdir, 'index.html'), 'utf8')).toContain('<span');
    } finally {
      await cleanup();
    }
  });

  it('restricts to a named page, and skips the asset copy', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      await writeFile(path.join(docroot, 'one.html'), '<html><body>one</body></html>');
      await writeFile(path.join(docroot, 'two.html'), '<html><body>two</body></html>');
      await writeFile(path.join(docroot, 'site.css'), 'body {}');

      // no leading slash and no extension: both spellings resolve
      const result = await run([docroot, outdir, '-p', 'one']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('1 page(s)');
      expect(result.stdout).toContain('no assets copied');
      await expect(readFile(path.join(outdir, 'one.html'), 'utf8')).resolves.toContain('one');
      await expect(readFile(path.join(outdir, 'two.html'), 'utf8')).rejects.toThrow();
      // the runtime is written even so: a page without it is not a page
      await expect(readFile(path.join(outdir, 'markout-runtime.js'), 'utf8')).resolves.toBeTruthy();
      await expect(readFile(path.join(outdir, 'site.css'), 'utf8')).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('takes -p more than once', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      for (const name of ['a', 'b', 'c']) {
        await writeFile(path.join(docroot, `${name}.html`), `<html><body>${name}</body></html>`);
      }

      const result = await run([docroot, outdir, '-p', 'a.html', '-p', '/c.html']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('2 page(s)');
      await expect(readFile(path.join(outdir, 'b.html'), 'utf8')).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('exits non-zero on a compile error, naming file, line and column', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      await writeFile(path.join(docroot, 'broken.html'), '<html><body>${nope}</body></html>');
      await writeFile(path.join(docroot, 'fine.html'), '<html><body>fine</body></html>');

      const result = await run([docroot, outdir]);

      // the status code is the point: a served page reports its errors to
      // whoever asks for it, while a built one is read by somebody who cannot
      // see this console, so CI has to be able to fail here
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/\/broken\.html:1:\d+: Unknown reference: "nope"/);
      // the pages that did compile are still written; only the broken one is not
      await expect(readFile(path.join(outdir, 'fine.html'), 'utf8')).resolves.toContain('fine');
      await expect(readFile(path.join(outdir, 'broken.html'), 'utf8')).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('copies the dotfiles a host needs, and none of the rest', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      await writeFile(path.join(docroot, 'index.html'), '<html><body>x</body></html>');
      // meant to be served: a deployable needs these, and a blanket dotfile
      // skip meant `.nojekyll` could not even reach a host that requires it
      await writeFile(path.join(docroot, '.nojekyll'), '');
      await writeFile(path.join(docroot, '.htaccess'), 'ErrorDocument 404 /404.html');
      await mkdir(path.join(docroot, '.well-known', 'acme-challenge'), { recursive: true });
      // no extension, as an ACME token has none
      await writeFile(path.join(docroot, '.well-known', 'acme-challenge', 'TOKEN'), 'proof');
      await writeFile(path.join(docroot, '.well-known', 'security.txt'), 'Contact: x@y.z');
      // must never be published, which is why this is an allow-list and not a
      // reversed rule: the set that must stay behind is open-ended
      await writeFile(path.join(docroot, '.env'), 'SECRET=hunter2');
      await writeFile(path.join(docroot, '.gitignore'), 'node_modules');
      await mkdir(path.join(docroot, '.git'), { recursive: true });
      await writeFile(path.join(docroot, '.git', 'config'), '[core]');

      const result = await run([docroot, outdir]);

      expect(result.code).toBe(0);
      await expect(readFile(path.join(outdir, '.nojekyll'), 'utf8')).resolves.toBe('');
      await expect(readFile(path.join(outdir, '.htaccess'), 'utf8')).resolves.toContain('404');
      await expect(
        readFile(path.join(outdir, '.well-known/acme-challenge/TOKEN'), 'utf8')
      ).resolves.toBe('proof');
      await expect(
        readFile(path.join(outdir, '.well-known/security.txt'), 'utf8')
      ).resolves.toContain('Contact');
      await expect(readFile(path.join(outdir, '.env'), 'utf8')).rejects.toThrow();
      await expect(readFile(path.join(outdir, '.gitignore'), 'utf8')).rejects.toThrow();
      await expect(readFile(path.join(outdir, '.git/config'), 'utf8')).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('refuses a docroot file named like the runtime', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      await writeFile(path.join(docroot, 'index.html'), '<html><body>x</body></html>');
      // the runtime is written first and the assets copied over it, so this
      // used to replace the runtime and report success -- every page in the
      // output broken by the one file nobody would think to suspect
      await writeFile(path.join(docroot, 'markout-runtime.js'), 'console.log("mine")');

      const result = await run([docroot, outdir]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('same name as the runtime');
      // refused before anything was written, rather than half-built
      await expect(readFile(path.join(outdir, 'index.html'), 'utf8')).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('fails on a `:server-` value that failed, and does not write the page', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      // nothing re-runs a `:server-` value in the browser -- it crosses frozen,
      // with a result and no expression -- so a page shipped without whatever
      // this was for would be without it permanently
      await writeFile(
        path.join(docroot, 'needs-server.html'),
        '<html :server-data=${Promise.reject(new Error("no request here"))}>' +
          '<body>${data ?? "-"}</body></html>'
      );
      await writeFile(path.join(docroot, 'fine.html'), '<html><body>fine</body></html>');

      const result = await run([docroot, outdir]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('/needs-server.html');
      expect(result.stderr).toContain('no request here');
      await expect(readFile(path.join(outdir, 'needs-server.html'), 'utf8')).rejects.toThrow();
      // the pages that are deliverable still are
      await expect(readFile(path.join(outdir, 'fine.html'), 'utf8')).resolves.toContain('fine');
    } finally {
      await cleanup();
    }
  });

  it('resolves a page-relative fetch against --origin', async () => {
    // The case this exists for: a docroot whose data sits in it as files. A
    // build has no request to take an origin from, so `/data.json` is not an
    // address at all -- and the moment anything is serving that directory it
    // is one again. Here that is six lines of `node:http`; for a real docroot
    // it is `markout <docroot>` in another terminal, or the host the pages
    // are being deployed to.
    const { docroot, outdir, cleanup } = await dirs();
    // A lookup rather than a path built out of `req.url`, which is both the
    // safe shape and the stricter test: a request for anything but the file
    // the page asks for is a 404, so a build resolving the url wrongly fails
    // here instead of being quietly answered anyway.
    const routes = new Map([['/data.json', path.join(docroot, 'data.json')]]);
    const served = createServer((req, res) => {
      const file = routes.get(`${req.url}`);
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      readFile(file, 'utf8').then(
        body => res.writeHead(200, { 'content-type': 'application/json' }).end(body),
        () => res.writeHead(404).end()
      );
    });
    await new Promise<void>(resolve => served.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(served.address() as AddressInfo).port}`;
    try {
      await writeFile(path.join(docroot, 'data.json'), '{"who":"a file in the docroot"}');
      // what `std-data` does, written out: a relative url means nothing on
      // its own, so it is resolved against the page's own origin
      await writeFile(
        path.join(docroot, 'index.html'),
        '<html :server-data=${fetch(new URL("/data.json", $origin))' +
          '.then(r => r.json())}><body>${data?.who ?? "-"}</body></html>'
      );

      const result = await run([docroot, outdir, '--origin', origin]);

      expect(result.code).toBe(0);
      // in the FILE, which is the whole mode: the answer was fetched once
      // while the page was built and nothing asks again
      await expect(readFile(path.join(outdir, 'index.html'), 'utf8')).resolves.toContain(
        'a file in the docroot'
      );

      // and without it the same page cannot be built at all, rather than
      // being written with a hole where its data was
      const alone = await run([docroot, outdir]);
      expect(alone.code).toBe(1);
    } finally {
      await new Promise<void>(resolve => served.close(() => resolve()));
      await cleanup();
    }
  });

  it('refuses an --origin that is not an absolute URL', async () => {
    // said once, about the flag, rather than once per datasource as a fetch
    // failure naming something the author did not write
    const { docroot, outdir, cleanup } = await dirs();
    try {
      await writeFile(path.join(docroot, 'index.html'), '<html><body>x</body></html>');

      const result = await run([docroot, outdir, '--origin', '127.0.0.1:3000']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('not an absolute URL');
      expect(existsSync(path.join(outdir, 'index.html'))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('only warns when an ordinary value throws, and writes the page', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      // the browser re-derives this one, where `later` may well have arrived:
      // it is the shape `${user.name}` takes before a datasource has answered,
      // and the served page is fine, so a build should not differ
      await writeFile(
        path.join(docroot, 'early.html'),
        '<html :later=${null}><body>${later.name}</body></html>'
      );

      const result = await run([docroot, outdir]);

      expect(result.code).toBe(0);
      expect(result.stderr).toContain('/early.html');
      await expect(readFile(path.join(outdir, 'early.html'), 'utf8')).resolves.toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('refuses an output directory inside the docroot', async () => {
    const { docroot, outdir, cleanup } = await dirs();
    try {
      await writeFile(path.join(docroot, 'index.html'), '<html><body>x</body></html>');

      const result = await run([docroot, path.join(docroot, 'dist')]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('would compile its own output');
    } finally {
      await cleanup();
    }
  });
});