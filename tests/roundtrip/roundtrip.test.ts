import fs from 'fs';
import path from 'path';
import { describe, it } from 'vitest';
import { Server } from '../../src/server/server';
import { Window } from 'happy-dom';
import { normalizeTextForComparison } from '../util';

const docroot = __dirname;
let server: Server;
let port: number;

beforeAll(async () => {
  server = await new Server({
    docroot,
    clientCodePath: `dist/client.js`,
  }).start();
  port = server.port!;
  console.log('==========> server port', port); //tempdebug
});

afterAll(async () => {
  await server.stop();
});

fs.readdirSync(docroot).forEach(dir => {
  const dirPath = path.join(docroot, dir);
  if (fs.statSync(dirPath).isDirectory() && !dir.startsWith('.')) {
    describe(dir, () => {
      fs.readdirSync(dirPath).forEach(file => {
        if (
          fs.statSync(path.join(dirPath, file)).isFile() &&
          file.endsWith('-in.html')
        ) {
          it(file, async () => {
            const url = `http://localhost:${port}/${dir}/${file}`;
            const win = new Window();
            const doc = win.document;
            const res = await fetch(url);
            const html = await res.text();
            doc.body.innerHTML = html;
            // Run your tests against the `doc` here
            console.log(doc.body.innerHTML); //tempdebug
            const outFile = file.replace('-in.html', '-out.html');
            const outPath = path.join(dirPath, outFile);
            if (fs.existsSync(outPath)) {
              const actualHtml = normalizeTextForComparison(
                doc.documentElement.outerHTML.trim()
              );
              console.log('Actual HTML:', actualHtml); //tempdebug
              const expectedHtml = normalizeTextForComparison(
                fs.readFileSync(outPath, 'utf-8').trim()
              );
              expect(actualHtml).toBe(expectedHtml);
            } else {
              // If no expected output file, just log the output for manual verification
              console.log('No expected output file found. Output HTML:');
              console.log(doc.body.innerHTML);
            }
          });
        }
      });
    });
  }
});
