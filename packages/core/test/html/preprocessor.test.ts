import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { Preprocessor } from '../../src/html/preprocessor';
import { checkFixture, listFixtures } from '../test-utils';

const docroot = path.join(__dirname, 'preprocessor');

fs.readdirSync(docroot).forEach(dir => {
  const dirPath = path.join(docroot, dir);
  if (fs.statSync(dirPath).isDirectory() && !dir.startsWith('.')) {
    describe(dir, () => {
      const preprocessor = new Preprocessor(dirPath);

      listFixtures(dirPath).forEach(fixture => {
        it(fixture.title, async () => {
          const source = await preprocessor.load(fixture.file);
          checkFixture(
            fixture,
            source.errors.map(e => e.msg),
            () => source.doc!.toString() + '\n'
          );
        });
      });
    });
  }
});

describe('files read', () => {
  const includes = path.join(docroot, 'includes');

  it('records the page and everything it pulled in, transitively', async () => {
    // the whole closure and in read order, not just what the page named
    // itself: test002b.htm brings the last two in
    const source = await new Preprocessor(includes).load('/test002imports-in.html');
    expect(source.errors).toEqual([]);
    expect(source.files).toEqual([
      '/test002imports-in.html',
      '/test002/test002b.htm',
      '/test002/test002b/test002c.htm',
      '/test002d.htm',
    ]);
  });

  it('records a file pulled in twice only once', async () => {
    // the fixture imports the same fragment twice, which is also what
    // `<:import>`'s once-only rule keys off -- the list IS that rule's state
    const source = await new Preprocessor(includes).load('/test002imports-in.html');
    expect(source.files.filter(f => f.endsWith('test002b.htm'))).toHaveLength(1);
  });

  it('records what it managed to read before a failure', async () => {
    const source = await new Preprocessor(includes).load('/test003-in.html');
    expect(source.errors.map(e => e.msg)).toContain('Forbidden pathname "../dummy.htm"');
    expect(source.files).toContain('/test003-in.html');
  });
});

describe('path containment', () => {
  it('should reject an <:include> escaping to a sibling directory sharing the docroot prefix', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-preprocessor-sec-'));
    const docroot = path.join(tempRoot, 'site');
    fs.mkdirSync(docroot);
    const sibling = path.join(tempRoot, 'site-secret');
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'passwd.html'), 'TOP SECRET');
    fs.writeFileSync(
      path.join(docroot, 'index.html'),
      '<html><body><:include src="../site-secret/passwd.html"/></body></html>'
    );

    const preprocessor = new Preprocessor(docroot);
    const source = await preprocessor.load('/index.html');

    expect(source.errors.map(e => e.msg)).toContain(
      'Forbidden pathname "../site-secret/passwd.html"'
    );
    expect(source.doc.toString()).not.toContain('TOP SECRET');
  });
});
