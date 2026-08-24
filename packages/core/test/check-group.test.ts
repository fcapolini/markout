import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../src/compiler';
import { discoverKits } from '../src/kits';
import { loadProps } from '../src/render/props';
import { renderPage } from '../src/render/render';
import { WebContext } from '../src/runtime/web/web-context';

/**
 * `bs-check-group`, driven the way a person drives it.
 *
 * What `:value` holds is decided by `:type`, because that is what the two
 * controls mean: a radio group submits one value, a checkbox group submits
 * every box that is ticked. It used to be one value either way, which made a
 * checkbox group a radio group that could not make up its mind -- ticking a
 * second box unticked the first, and unticking a box left it ticked. The
 * Orbit demo's notification summary read the value and so read one channel
 * whatever was on screen.
 *
 * Driven through the DOM rather than by assigning values, because the bug
 * was entirely in the `:on-change` handler and a test that writes `value`
 * itself would have passed throughout.
 */
let root: string;
let docroot: string;
let kits: ReturnType<typeof discoverKits>['kits'];
let seq = 0;

beforeAll(() => {
  // the real kit, installed beside a docroot the way a project installs it,
  // so what is under test is the file that ships rather than a copy of it
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-check-'));
  docroot = path.join(root, 'site');
  fs.mkdirSync(docroot);
  const dir = path.join(root, 'node_modules', '@markout-lang');
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(path.resolve(__dirname, '../../../kits/bootstrap-kit'),
    path.join(dir, 'bootstrap-kit'), 'dir');
  kits = discoverKits(docroot).kits;
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

async function run(body: string) {
  const name = `p${seq++}.html`;
  fs.writeFileSync(
    path.join(docroot, name),
    '<html><head><:import src="/bootstrap-kit/parts/check.htm" />' +
      `</head><body>${body}</body></html>`
  );
  const page = await new Compiler({ docroot, kits }).compile(`/${name}`);
  expect(page.errors.filter(e => e.type === 'error').map(e => e.msg)).toStrictEqual([]);
  await renderPage(page);
  const doc = page.source.doc as unknown as {
    documentElement: { toString(): string };
  };
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: () => undefined,
  }).refresh();
  /** the group's own scope, named with `:aka` on a usage site inside <body> */
  const group = () => (ctx.root.proxy as Record<string, any>).body.g;
  const allScopes = (s: any, out: any[] = []): any[] => {
    out.push(s);
    (s.children ?? []).forEach((c: any) => allScopes(c, out));
    return out;
  };
  /**
   * Ticks or unticks the box for `name`, then fires `change` at it.
   *
   * The state flips first and the event follows, which is the order a
   * browser does it in and the order the handler is written for. Read back
   * off the attribute rather than held here, since `:attr-checked` is what
   * maintains it and this has to see what the page sees.
   */
  const click = (name: string) => {
    const el: any = inputs().find(b => b.getAttribute('value') === name);
    expect(el, `no box for "${name}"`).toBeTruthy();
    el.checked = el.getAttribute('checked') === null;
    el.value = name;
    const scope = allScopes(ctx.root).find((s: any) => s.dom === el);
    expect(scope, `no scope for the "${name}" box`).toBeTruthy();
    const listener = scope.domListeners?.find((l: any) => l.name === 'change');
    expect(listener, `nothing listening for change on "${name}"`).toBeTruthy();
    listener.listener({ type: 'change', target: el } as unknown as Event);
  };
  function inputs(): any[] {
    const out: any[] = [];
    const walk = (n: any) => {
      if (n.tagName === 'INPUT') out.push(n);
      (n.childNodes ?? []).forEach(walk);
    };
    walk(page.source.doc.documentElement);
    return out;
  }
  /** which boxes the markup says are ticked, which is what a reload restores */
  const ticked = () =>
    inputs()
      .filter(i => i.getAttribute('checked') !== null)
      .map(i => i.getAttribute('value'));
  return { group, click, ticked, markup: () => doc.documentElement.toString() };
}

const GROUP = (extra: string) =>
  `<bs-check-group :aka="g" ::options=\${['Email', 'Slack', 'SMS']} ${extra} />`;

describe('a checkbox group', () => {
  it('starts as the array it was given', async () => {
    const { group, ticked } = await run(GROUP('::type="checkbox" ::value=${[\'Slack\']}'));
    expect(group().value).toStrictEqual(['Slack']);
    expect(ticked()).toStrictEqual(['Slack']);
  });

  it('adds a box without taking the others away', async () => {
    const { group, click, ticked } = await run(
      GROUP('::type="checkbox" ::value=${[\'Slack\']}')
    );
    click('Email');
    expect(group().value).toStrictEqual(['Email', 'Slack']);
    expect(ticked()).toStrictEqual(['Email', 'Slack']);
  });

  it('takes a box away when it is unticked', async () => {
    const { group, click, ticked } = await run(
      GROUP('::type="checkbox" ::value=${[\'Email\', \'Slack\']}')
    );
    click('Slack');
    expect(group().value).toStrictEqual(['Email']);
    expect(ticked()).toStrictEqual(['Email']);
  });

  it('reports them in the order the options were given, not clicked', async () => {
    const { group, click } = await run(GROUP('::type="checkbox" ::value=${[]}'));
    click('SMS');
    click('Email');
    // a summary sentence reading this must not reorder itself under the reader
    expect(group().value).toStrictEqual(['Email', 'SMS']);
  });

  it('empties to an array rather than to null', async () => {
    const { group, click } = await run(GROUP('::type="checkbox" ::value=${[\'Slack\']}'));
    click('Slack');
    expect(group().value).toStrictEqual([]);
  });

  it('defaults to nothing selected', async () => {
    const { group, ticked } = await run(GROUP('::type="checkbox"'));
    expect(group().value).toStrictEqual([]);
    expect(ticked()).toStrictEqual([]);
  });

  it('reads a lone value as a list of one', async () => {
    // `:options` already reads a lone string as an entry, and spreading a
    // string into its characters is not what `::value="Slack"` says
    const { group, ticked } = await run(GROUP('::type="checkbox" ::value="Slack"'));
    expect(ticked()).toStrictEqual(['Slack']);
    expect(group().value).toBe('Slack');
  });

  it('treats a group of switches the same way', async () => {
    const { group, click } = await run(GROUP('::type="switch" ::value=${[]}'));
    click('Email');
    click('SMS');
    expect(group().value).toStrictEqual(['Email', 'SMS']);
  });
});

describe('a radio group', () => {
  it('still holds one value, and replaces it', async () => {
    const { group, click, ticked } = await run(GROUP('::value=${\'Slack\'}'));
    expect(group().value).toBe('Slack');
    click('Email');
    expect(group().value).toBe('Email');
    expect(ticked()).toStrictEqual(['Email']);
  });

  it('defaults to nothing selected, as null rather than as a list', async () => {
    const { group, ticked } = await run(GROUP(''));
    expect(group().value).toBe(null);
    expect(ticked()).toStrictEqual([]);
  });
});
