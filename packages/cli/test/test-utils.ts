import fs from 'fs';
import path from 'path';
import { assert } from 'vitest';
import { normalizeText } from '../src/html/parser';

/**
 * Normalizes line endings to LF (\n) for cross-platform compatibility
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Normalizes text for comparison by handling both whitespace and line endings
 */
export function normalizeTextForComparison(text: string): string {
  return normalizeText(normalizeLineEndings(text)) || '';
}

/**
 * A `<name>-in.html` fixture, paired with its expected result: either
 * `<name>-err.json` (expected errors) or an output file whose suffix depends
 * on the suite — `-out.html` for markup, `-out.js` for generated code.
 * `descriptions.json` in the same directory optionally maps fixture names to
 * a one-line description, used in the test title.
 */
export interface Fixture {
  dir: string;
  /** input file name, e.g. `037-in.html` */
  file: string;
  /** fixture name without suffix, e.g. `037` */
  name: string;
  /** test title, including the description when one is available */
  title: string;
}

export function listFixtures(dir: string): Fixture[] {
  const descriptions = readDescriptions(dir);
  return fs
    .readdirSync(dir)
    .filter(
      file =>
        file.endsWith('-in.html') && fs.statSync(path.join(dir, file)).isFile()
    )
    .sort()
    .map(file => {
      const name = file.replace('-in.html', '');
      const desc = descriptions[name];
      return { dir, file, name, title: desc ? `${name}: ${desc}` : name };
    });
}

/** Directories holding fixtures, for suites that group them by feature. */
export function listFixtureDirs(docroot: string): string[] {
  return fs
    .readdirSync(docroot)
    .filter(
      d =>
        !d.startsWith('.') && fs.statSync(path.join(docroot, d)).isDirectory()
    )
    .sort();
}

function readDescriptions(dir: string): Record<string, string> {
  const pname = path.join(dir, 'descriptions.json');
  if (!fs.existsSync(pname)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(pname, { encoding: 'utf8' }));
}

export function fixturePath(fixture: Fixture, suffix: string): string {
  return path.join(fixture.dir, `${fixture.name}${suffix}`);
}

/**
 * Compares a fixture's actual result against its expected one, failing with
 * an actionable message when the expected file is missing, is of the wrong
 * kind (an `-err.json` for a fixture that succeeds, or vice versa), or
 * doesn't match.
 *
 * `errors` are compared structurally, so a suite can pass either messages or
 * whole error objects. `outSuffix` selects the expected-output file.
 */
export function checkFixture(
  fixture: Fixture,
  errors: unknown[],
  output: () => string,
  outSuffix = '-out.html'
): void {
  const { name } = fixture;
  const errPath = fixturePath(fixture, '-err.json');
  const outPath = fixturePath(fixture, outSuffix);
  const hasErrFile = fs.existsSync(errPath);
  const hasOutFile = fs.existsSync(outPath);

  if (errors.length) {
    assert.isTrue(
      hasErrFile,
      `${name} reported errors but has no ${name}-err.json.\n` +
        `Create it with: ${JSON.stringify(errors)}`
    );
    const expected = JSON.parse(fs.readFileSync(errPath, { encoding: 'utf8' }));
    assert.deepEqual(errors, expected, `${name}: unexpected errors`);
    return;
  }

  assert.isFalse(
    hasErrFile,
    `${name} has ${name}-err.json but completed without errors`
  );
  assert.isTrue(hasOutFile, `${name} is missing ${name}${outSuffix}`);
  const expected = fs.readFileSync(outPath, { encoding: 'utf8' });
  assert.equal(
    normalizeTextForComparison(output()),
    normalizeTextForComparison(expected),
    `${name}: unexpected ${outSuffix.replace(/^-out\./, '')}`
  );
}
