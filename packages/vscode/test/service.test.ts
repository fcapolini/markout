import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetPages } from '../src/pages';
import { createMarkoutService } from '../src/service';

/**
 * The service, asked the one question that has nowhere else to go.
 *
 * A workspace sweep is bounded, and a bound that is never mentioned reads as
 * "nothing else is wrong" -- which is the one thing it does not mean. Where
 * it used to be mentioned was `console.warn`, in a process the author of a
 * page has no reason to be watching.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-service-'));
  forgetPages();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** the service, with nothing of Volar's around it that this question needs */
function sweeping(props: { limit?: number; warn?: (message: string) => void }) {
  const service = createMarkoutService({
    workspaceFolders: [root],
    open: () => undefined,
    ...props,
  });
  const created = service.create({
    decodeEmbeddedDocumentUri: () => undefined,
  } as never) as { provideWorkspaceDiagnostics(): Promise<unknown[]> };
  return created.provideWorkspaceDiagnostics();
}

describe('a sweep that stopped early', () => {
  beforeEach(() => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 's', dependencies: { markout: '^0.2.0' } })
    );
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(root, `p${i}.html`), '<html><body>${nope}</body></html>');
    }
  });

  it('says so where the author is looking', async () => {
    const said: string[] = [];
    await sweeping({ limit: 2, warn: message => said.push(message) });
    expect(said).toHaveLength(1);
    // the numbers, both of them: "some pages were skipped" is not something
    // anybody can act on, and 2 of 5 is a different situation from 200 of 204
    expect(said[0]).toMatch(/2/);
    expect(said[0]).toMatch(/3/);
  });

  it('says nothing when it got to the end', async () => {
    const said: string[] = [];
    await sweeping({ warn: message => said.push(message) });
    expect(said).toStrictEqual([]);
  });
});
