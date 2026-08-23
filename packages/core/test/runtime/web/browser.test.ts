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
