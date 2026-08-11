import fs from 'fs';
import path from 'path';
import { describe, it } from 'vitest';
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
