import fs from 'fs';
import { assert, describe, it } from 'vitest';
import path from 'path';
import { Preprocessor } from '../../src/html/preprocessor';
import { normalizeText } from '../../src/html/parser';
import { normalizeTextForComparison } from '../util';

const docroot = path.join(__dirname, 'preprocessor');

fs.readdirSync(docroot).forEach(dir => {
  const dirPath = path.join(docroot, dir);
  if (fs.statSync(dirPath).isDirectory() && !dir.startsWith('.')) {
    describe(dir, () => {
      const preprocessor = new Preprocessor(dirPath);

      fs.readdirSync(dirPath).forEach(file => {
        if (
          fs.statSync(path.join(dirPath, file)).isFile() &&
          file.endsWith('-in.html')
        ) {
          it(file, async () => {
            const source = await preprocessor.load(file);
            if (source.errors.length) {
              const fname = file.replace('-in.html', '-err.json');
              const pname = path.join(dirPath, fname);
              const aerrs = source.errors.map(e => e.msg);
              let eerrs = [];
              try {
                const etext = (await fs.promises.readFile(pname)).toString();
                eerrs = JSON.parse(etext);
                assert.deepEqual(aerrs, eerrs);
              } catch (e) {
                assert.deepEqual(aerrs, eerrs);
              }
            } else {
              // const actualHTML = getMarkup(source.ast!) + '\n';
              const actualHTML = source.doc!.toString() + '\n';
              const pname = path.join(
                docroot,
                dir,
                file.replace('-in.', '-out.')
              );
              const expectedHTML = await fs.promises.readFile(pname, {
                encoding: 'utf8',
              });
              assert.equal(
                normalizeTextForComparison(actualHTML),
                normalizeTextForComparison(expectedHTML)
              );
            }
          });
        }
      });
    });
  }
});
