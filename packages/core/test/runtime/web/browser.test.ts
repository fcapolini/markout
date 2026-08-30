import { describe, expect, it, vi, afterEach } from 'vitest';
import { parse } from '../../../src/html/parser';
import { PROPS_GLOBAL } from '../../../src/runtime/core/core-context';
import { init } from '../../../src/runtime/web/browser';

describe('browser bootstrap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should construct and refresh a WebContext from window[PROPS_GLOBAL]', () => {
    const source = parse('<html data-markout="0"></html>', 'test');
    // as a page carries them: the expressions in `e`, the tree in `p`
    vi.stubGlobal('window', {
      [PROPS_GLOBAL]: { e: [], p: { id: '0', values: { attr$lang: { val: 'en' } } } },
    });
    vi.stubGlobal('document', source.doc);

    const context = init();

    expect(context).toBeDefined();
    expect(source.doc.documentElement?.getAttribute('lang')).toBe('en');
  });

  /**
   * The address a page reads has to be the one it is at, and a fragment
   * link is the case that says which signals are needed: `<a href="#x">`
   * is a same-document navigation that pushes a history entry and fires
   * `hashchange` -- not `popstate`, which is a traversal and only a
   * traversal, and not `navigatesuccess` in a browser that has no
   * Navigation API. Listening to one of the three left `$url` answering
   * with the address the page was served at while the address bar had
   * moved on.
   */
  it('follows the address through every signal a browser gives it', () => {
    const source = parse('<html data-markout="0"></html>', 'test');
    const listeners = new Map<string, () => void>();
    let href = 'http://x.test/doc';
    vi.stubGlobal('window', {
      [PROPS_GLOBAL]: { e: [], p: { id: '0', values: {} } },
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    });
    vi.stubGlobal('document', source.doc);
    vi.stubGlobal('location', {
      get origin() { return 'http://x.test'; },
      get href() { return href; },
    });

    const context = init()!;
    const url = () => `${(context.global.values['$url'].get() as URL | undefined)?.href}`;
    expect(url()).toBe('http://x.test/doc');
    // both are attached, and neither alone would do
    expect([...listeners.keys()].sort()).toStrictEqual(['hashchange', 'popstate']);

    href = 'http://x.test/doc#two';
    listeners.get('hashchange')!();
    expect(url()).toBe('http://x.test/doc#two');

    href = 'http://x.test/other';
    listeners.get('popstate')!();
    expect(url()).toBe('http://x.test/other');
  });

  it('should log an error and do nothing when the props global is missing', () => {
    const source = parse('<html data-markout="0"></html>', 'test');
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', source.doc);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const context = init();

    expect(context).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(PROPS_GLOBAL));
    errorSpy.mockRestore();
  });
});
