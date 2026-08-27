import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featuredKits, FEATURED_SCOPE, KIT_KEYWORD, searchKits } from '../../src/kits/listing';

/**
 * Finding kits to install, and the one thing that must not be spoofable.
 *
 * The offered list is the sidebar's "these are ours" signal, so what belongs
 * on it is decided by the SCOPE -- which npm guarantees and only its owner
 * may publish under -- and not by anything a package says about itself. See
 * docs/design/without-node.md.
 */

let queries: string[];

beforeEach(() => {
  queries = [];
  vi.stubEnv('MARKOUT_REGISTRY', 'https://fixture.test');
  vi.stubGlobal('fetch', async (url: string) => {
    queries.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        objects: [
          { package: { name: '@markout-lang/std-kit', version: '1.0.0', description: 'ours' } },
          { package: { name: '@markout-lang/bootstrap-kit', version: '2.0.0' } },
          // published by somebody else, carrying the keyword quite legally
          { package: { name: '@acme/impostor-kit', version: '9.9.9' } },
          { package: { name: 'markout-kit-lookalike', version: '1.0.0' } },
        ],
      }),
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('searchKits', () => {
  it('asks for the keyword, which is the declaration a kit makes', () => {
    return searchKits().then(() => {
      expect(decodeURIComponent(queries[0])).toContain(`keywords:${KIT_KEYWORD}`);
    });
  });

  it('narrows within the keyword rather than outside it', async () => {
    await searchKits('table');
    const asked = decodeURIComponent(queries[0]);
    expect(asked).toContain(`keywords:${KIT_KEYWORD}`);
    expect(asked).toContain('table');
  });

  it('returns everything that declares itself a kit', async () => {
    expect((await searchKits()).map(k => k.name)).toContain('@acme/impostor-kit');
  });
});

describe('featuredKits', () => {
  it('keeps only this project\'s scope', async () => {
    // npm's `scope:` qualifier does not filter -- measured -- so the query
    // answers with everybody's kits and the scope is checked here. Without
    // this, the list that means "these are ours" is joinable by anyone who
    // publishes with the keyword
    const found = await featuredKits();
    expect(found.map(k => k.name)).toEqual([
      '@markout-lang/bootstrap-kit',
      '@markout-lang/std-kit',
    ]);
  });

  it('is not fooled by a name that merely starts the same way', async () => {
    expect((await featuredKits()).map(k => k.name)).not.toContain(
      'markout-kit-lookalike'
    );
  });

  it('requires the scope separator, not just the prefix', async () => {
    // `@markout-langsomething/x` starts with the scope's characters and is a
    // different scope entirely
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        objects: [{ package: { name: '@markout-langother/kit', version: '1.0.0' } }],
      }),
    } as unknown as Response));
    expect(await featuredKits()).toEqual([]);
  });

  it('names the scope it trusts', () => {
    expect(FEATURED_SCOPE).toBe('@markout-lang');
  });
});
