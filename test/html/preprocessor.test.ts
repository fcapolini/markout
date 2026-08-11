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
