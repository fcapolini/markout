import * as acorn from 'acorn';
import { generate } from 'escodegen';
import fs from 'fs';
import path from 'path';
import { assert, describe, it } from 'vitest';
import { Compiler } from '../../src/compiler/compiler';
import { normalizeText } from '../../src/html/parser';
import { cleanupScopes } from '../util';

const docroot = __dirname;

fs.readdirSync(docroot).forEach(dir => {
  const dirPath = path.join(docroot, dir);
  if (
    fs.statSync(dirPath).isDirectory() &&
    !dir.startsWith('.')
  ) {

    describe(dir, () => {
      const compiler = new Compiler({ docroot: dirPath });

      fs.readdirSync(dirPath).forEach(file => {
        if (
          fs.statSync(path.join(dirPath, file)).isFile() &&
          file.endsWith('-in.html')
        ) {

          it(file, async () => {
            const page = await compiler.compile(file);
            const source = page.source;
            // check errors
            const errpname = path.join(dirPath, file.replace('-in.html', '-err.json'));
            if (source.errors.length || fs.existsSync(errpname)) {
              const aerrs = JSON.parse(JSON.stringify(source.errors));
              let eerrs = [];
              try {
                const etext = (await fs.promises.readFile(errpname)).toString();
                eerrs = JSON.parse(etext);
                assert.deepEqual(aerrs, eerrs);
              } catch (e) {
                assert.deepEqual(aerrs, eerrs);
              }
              return;
            }
            // check output markup
            const outpname = path.join(docroot, dir, file.replace('-in.', '-out.'));
            if (fs.existsSync(outpname)) {
              const actualHTML = source.doc!.toString() + '\n';
              const expectedHTML = await fs.promises.readFile(outpname, { encoding: 'utf8' });
              assert.equal(normalizeText(actualHTML), normalizeText(expectedHTML));
            }
            // check compiler scopes
            const jsonpname = path.join(docroot, dir, file.replace('-in.html', '-out.json'));
            if (fs.existsSync(jsonpname)) {
              const text = await fs.promises.readFile(jsonpname, { encoding: 'utf8' });
              const root = JSON.parse(text);
              page.root && cleanupScopes(page.root);
              assert.deepEqual(JSON.parse(JSON.stringify(page.root)), root);
            }
            // check generated code
            const jspname = path.join(docroot, dir, file.replace('-in.html', '-out.js'));
            if (fs.existsSync(jspname)) {
              const text = await fs.promises.readFile(jspname, { encoding: 'utf8' });
              const ast = acorn.parse(text, { ecmaVersion: 'latest' });
              const expected = generate(ast);
              const actual = generate(page.code);
              assert.equal(actual, expected);
            }
          });

        }
      });
    });

  }
});
