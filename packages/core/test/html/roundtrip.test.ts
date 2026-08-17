import fs from 'fs';
import path from 'path';
import { assert, describe, it } from 'vitest';
import { parse } from '../../src/html/parser';
import { listFixtures } from '../test-utils';

/**
 * Serializing a document and parsing it again must produce the same markup:
 * any asymmetry between how text/attributes are unescaped on parse and
 * escaped on serialization shows up here, for every fixture at once.
 */
describe('parse(serialize(x)) === serialize(x)', () => {
  const docroot = path.join(__dirname, 'parser');

  listFixtures(docroot)
    // error fixtures have no serializable document
    .filter(f => fs.existsSync(path.join(docroot, `${f.name}-out.html`)))
    .forEach(fixture => {
      it(fixture.title, () => {
        const text = fs
          .readFileSync(path.join(docroot, fixture.file))
          .toString();
        const first = parse(text, fixture.file);
        const once = first.doc!.toString();

        const second = parse(once, fixture.file);
        assert.deepEqual(
          second.errors.map(e => e.msg),
          [],
          'serialized markup failed to parse'
        );
        assert.equal(second.doc!.toString(), once);
      });
    });
});
