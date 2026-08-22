import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from '../../src/server';

/**
 * A page the server cannot look at, as against one that is not there.
 *
 * Both answer the visitor 404, which is the only answer a visitor has any
 * use for. They must not look the same to whoever runs the site: one is a
 * URL nobody has, and the other is a deployment that is broken while
 * reporting itself empty -- a permission on a docroot, an EMFILE under
 * load, a volume that has gone away. Every one of those used to arrive as
 * an ordinary 404, in an access log full of them, with the file sitting
 * right there.
 */
describe('a docroot the server cannot read', () => {
  let dir: string;
  let readable = true;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-unreadable-'));
    fs.mkdirSync(path.join(dir, 'locked'));
    fs.writeFileSync(
      path.join(dir, 'locked', 'page.html'),
      '<html><body>hi</body></html>'
    );
    fs.chmodSync(path.join(dir, 'locked'), 0o000);
    // root ignores the mode, and so does any filesystem that does not carry
    // one: probe rather than assume, so this reports nothing instead of
    // failing where it cannot be true
    try {
      fs.statSync(path.join(dir, 'locked', 'page.html'));
      readable = true;
    } catch {
      readable = false;
    }
  });

  afterAll(() => {
    fs.chmodSync(path.join(dir, 'locked'), 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('says so, and still answers the visitor 404', async () => {
    if (readable) return; // running as root, or on a filesystem with no modes
    const said: string[] = [];
    const app = await new Server({
      docroot: dir,
      logger: (type, msg) => said.push(`${type} ${msg}`),
    }).create();

    const res = await request(app).get('/locked/page');
    expect(res.status).toBe(404);
    expect(said.join('\n')).toMatch(/EACCES/);
    expect(said.join('\n')).toMatch(/locked\/page/);
  });

  it('says nothing for a page that is simply not there', async () => {
    const said: string[] = [];
    const app = await new Server({
      docroot: dir,
      logger: (type, msg) => said.push(`${type} ${msg}`),
    }).create();
    said.length = 0;

    const res = await request(app).get('/no-such-page');
    expect(res.status).toBe(404);
    expect(said.join('\n')).not.toMatch(/cannot tell/);
  });
});
