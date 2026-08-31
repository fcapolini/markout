/**
 * Puts the real test counts into the README's "How it's built" line.
 *
 * That line is a trust signal -- somebody deciding whether to read further
 * wants to know the suite is not three smoke tests -- and it is the one
 * number in the file that nothing keeps honest. It said 2,696 across 134
 * files while the suite ran 2,867 across 145, which is the failure mode of
 * every hand-copied number: it is not wrong when it is written, it goes
 * wrong quietly afterwards, and the direction of the drift always
 * understates the work.
 *
 * A test asserting the number would have been the tidier-looking answer and
 * is the wrong one twice over. It cannot know the total from inside the run
 * -- vitest has it, the tests do not -- so it would have to count `it(`
 * occurrences with a regex and disagree with the reporter over `it.each`,
 * loops and skips. And it would fail every pull request that adds a test,
 * turning a documentation nicety into a merge blocker.
 *
 * So: a script, run when the number matters -- before a release, or when
 * somebody notices -- rather than a check that runs always.
 *
 *   npm run test-count            # runs the suite, then rewrites the line
 *   npm run test-count -- x.json  # reuses a vitest --reporter=json file
 *
 * The second form is for CI or for a suite that has just run: `vitest run
 * --reporter=json --outputFile=x.json` writes what this reads, so the
 * numbers come from the reporter itself rather than from counting anything.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(ROOT, 'README.md');

/** `2,696 tests across 134 files, ...` -- the counts, and whatever follows */
const LINE = /^([\d,]+) tests across (\d+) files(,.*)$/m;

function report(given) {
  if (given) return JSON.parse(fs.readFileSync(path.resolve(given), 'utf8'));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mo-count-')), 'r.json');
  // inherit, so the suite's own output is what the caller watches
  execFileSync(
    'npx',
    ['vitest', 'run', '--reporter=json', '--outputFile', out],
    { cwd: ROOT, stdio: 'inherit' }
  );
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const r = report(process.argv[2]);
const tests = r.numTotalTests;
const files = r.testResults?.length;
if (!tests || !files) {
  console.error('no counts in that report: numTotalTests and testResults are what this reads');
  process.exit(1);
}

const src = fs.readFileSync(README, 'utf8');
const found = LINE.exec(src);
if (!found) {
  console.error(`no "N tests across M files" line in ${path.relative(ROOT, README)}`);
  process.exit(1);
}

const line = `${tests.toLocaleString('en-US')} tests across ${files} files${found[3]}`;
if (found[0] === line) {
  console.log(`README is current: ${tests.toLocaleString('en-US')} tests, ${files} files`);
  process.exit(0);
}

fs.writeFileSync(README, src.replace(LINE, line));
console.log(`README: ${found[1]} tests / ${found[2]} files -> ${tests.toLocaleString('en-US')} / ${files}`);
