import { registryUrl, type KitVersion } from './registry';

/**
 * Finding kits to install, without a service to run.
 *
 * The registry already answers the question, and a listing service of our own
 * would be a server to keep up, a moderation queue to staff and an outage to
 * own -- for a feature whose entire data layer is "which packages say they
 * are kits". One becomes worth building when the query below stops being
 * enough, which is a problem worth having later. See
 * docs/design/without-node.md.
 *
 * ## Why a keyword and not a name
 *
 * A kit declares `"keywords": ["markout-kit"]`, and that is the whole
 * convention. The alternatives both lose:
 *
 * - A NAME convention (`markout-kit-*`) would exclude
 *   `@markout-lang/bootstrap-kit`, stop `@acme/design-system` from being a
 *   kit at all, and cost every author their name -- while being
 *   unenforceable, since nothing stops a non-kit calling itself
 *   `markout-kit-anything`.
 * - A LOOSE text search for the words matches README prose, so it returns
 *   packages whose authors never opted in. A kit's code becomes part of the
 *   pages its user ships, which is exactly where an explicit declaration
 *   beats an inference.
 *
 * Neither the keyword nor the name is the real gate, though. That is
 * `markout.root`, checked against the package's own manifest before anything
 * is installed -- so a package that games the keyword still cannot be
 * installed as a kit.
 */

/** the keyword a kit declares itself with, for anything that lists kits */
export const KIT_KEYWORD = 'markout-kit';

/** one search result: enough to show a row, never enough to install from */
export interface KitListing {
  name: string;
  version: string;
  description?: string;
  /** npm's own relevance score, 0..1, for ordering */
  score?: number;
  publisher?: string;
  links?: { npm?: string; homepage?: string };
}

/**
 * Kits in the registry, by the keyword they declare.
 *
 * `text` is left free so a caller can narrow within the keyword rather than
 * outside it: `searchKits('table')` asks for kits about tables, and never for
 * packages that merely mention markout.
 */
export async function searchKits(text = '', size = 50): Promise<KitListing[]> {
  const query = [`keywords:${KIT_KEYWORD}`, text.trim()].filter(s => s).join(' ');
  const url =
    `${registryUrl()}/-/v1/search?text=${encodeURIComponent(query)}` +
    `&size=${Math.min(Math.max(size, 1), 250)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`registry search answered ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    objects?: { package?: Record<string, unknown>; score?: { final?: number } }[];
  };
  return (body.objects ?? [])
    .map(o => o.package)
    .filter((p): p is Record<string, unknown> => !!p && typeof p.name === 'string')
    .map(p => ({
      name: p.name as string,
      version: typeof p.version === 'string' ? p.version : '',
      description: typeof p.description === 'string' ? p.description : undefined,
      publisher: (p.publisher as { username?: string } | undefined)?.username,
      links: p.links as KitListing['links'],
    }));
}

/**
 * The scope this project's own kits are published under.
 *
 * A NAME prefix, checked here, and not a registry query. npm's search accepts
 * a `scope:` qualifier and does not honour it as a filter -- measured:
 * `scope:markout-lang keywords:eslint-plugin` answers with seven thousand
 * eslint plugins, none of them in that scope. So a query asking for our kits
 * would in fact answer with everybody's, and the list that means "these are
 * ours" would be joinable by anyone who publishes with the keyword.
 *
 * The scope itself is the thing that cannot be spoofed: npm guarantees it,
 * and only its owner may publish under it.
 */
export const FEATURED_SCOPE = '@markout-lang';

/**
 * This project's own kits, offered before anything is searched for.
 *
 * Asked of the registry rather than hard-coded, so that publishing a kit
 * makes it appear without an extension release -- a hard-coded list is a
 * second place to remember, and the one nobody remembers.
 *
 * There is no offline fallback and none is needed: this list exists to be
 * installed from, and installing needs the registry anyway. A caller with no
 * network gets an empty list and should say so rather than reporting that
 * there are no kits.
 *
 * Offered first, and reaching an arbitrary registry package left as a second,
 * deliberate action. A kit's code compiles into every page that imports it,
 * so that ought to look like the decision it is.
 */
export async function featuredKits(): Promise<KitListing[]> {
  const found = await searchKits();
  return found
    .filter(kit => kit.name.startsWith(`${FEATURED_SCOPE}/`))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** whether a resolved package may be offered for install at all */
export function isKit(resolved: Pick<KitVersion, 'root'>): boolean {
  return !!resolved.root;
}
