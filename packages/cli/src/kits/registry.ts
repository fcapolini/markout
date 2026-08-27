import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The npm registry, as the HTTPS API it is.
 *
 * No npm anywhere in here, which is the point: the audience this serves has
 * no npm on its PATH and frequently none on the machine, and bundling a copy
 * would reproduce every failure mode it has (see docs/design/without-node.md,
 * *Rejected along the way*). A packument is JSON over HTTPS and a tarball is
 * gzip, both of which Node can do unaided.
 *
 * What this is NOT is a package manager. It resolves one exact version, of
 * one package, and unpacks it. There is no dependency graph, no lockfile and
 * no semver range, because a kit is `.htm` and CSS with no install step
 * behind it, and because the manifest pins exact versions on purpose.
 */

/** where to ask; overridable for a mirror, and for the tests */
export function registryUrl(): string {
  return (
    process.env.MARKOUT_REGISTRY ||
    process.env.npm_config_registry ||
    'https://registry.npmjs.org'
  ).replace(/\/+$/, '');
}

/**
 * The shared tarball cache.
 *
 * Under the user's home rather than the project, so that every project after
 * the first is a local copy: instant, and offline. Copied out rather than
 * linked in, so the project stays self-contained and committable.
 */
export function cacheDir(): string {
  return process.env.MARKOUT_CACHE || path.join(os.homedir(), '.markout', 'cache');
}

/** what the registry says about one version of a package */
export interface KitVersion {
  name: string;
  version: string;
  /** its `markout.root`, if it has one -- absent means it is not a kit */
  root?: string;
  tarball: string;
  /** `sha512-<base64>`, or a legacy hex sha1 in `shasum` */
  integrity?: string;
  shasum?: string;
  description?: string;
}

/**
 * Resolve `name` at `version` -- an exact version, or `latest`.
 *
 * The FULL packument rather than the abbreviated one npm's installer uses:
 * the abbreviated form drops keys it does not recognise, and `markout.root`
 * is exactly such a key. Asking for the whole thing costs a larger response
 * and buys the ability to say "that package is not a kit" before anything has
 * been written to disk.
 */
export async function resolveKit(name: string, version = 'latest'): Promise<KitVersion> {
  const url = `${registryUrl()}/${name.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) {
    throw new Error(`no package "${name}" in the registry at ${registryUrl()}`);
  }
  if (!res.ok) {
    throw new Error(`registry answered ${res.status} ${res.statusText} for "${name}"`);
  }
  const packument = (await res.json()) as {
    'dist-tags'?: Record<string, string>;
    versions?: Record<string, Record<string, unknown>>;
  };
  const exact =
    version === 'latest' ? packument['dist-tags']?.latest : version;
  if (!exact) {
    throw new Error(`"${name}" has no "latest" tag; ask for a version`);
  }
  const found = packument.versions?.[exact];
  if (!found) {
    const known = Object.keys(packument.versions ?? {});
    throw new Error(
      `"${name}" has no version ${exact}` +
        (known.length ? ` -- latest is ${known[known.length - 1]}` : '')
    );
  }
  const dist = (found.dist ?? {}) as { tarball?: string; integrity?: string; shasum?: string };
  if (!dist.tarball) {
    throw new Error(`"${name}@${exact}" has no tarball in the registry`);
  }
  const markout = found.markout as { root?: unknown } | undefined;
  return {
    name,
    version: exact,
    root: typeof markout?.root === 'string' ? markout.root : undefined,
    tarball: dist.tarball,
    integrity: dist.integrity,
    shasum: dist.shasum,
    description: typeof found.description === 'string' ? found.description : undefined,
  };
}

/**
 * The tarball for `kit`, from the cache or from the network.
 *
 * Verified either way. A cached file is bytes on a disk that other things can
 * write to, and checking it costs one hash of 164 KB -- so the cache is a
 * speed-up and never a way to skip the check.
 */
export async function fetchTarball(kit: KitVersion): Promise<Buffer> {
  const cached = path.join(cacheDir(), cacheName(kit));
  if (fs.existsSync(cached)) {
    const bytes = fs.readFileSync(cached);
    if (verify(kit, bytes)) {
      return bytes;
    }
    // a corrupt cache entry is a thing to replace, not a thing to report:
    // the network has the answer and the user asked for the kit, not for a
    // lecture about their disk
    fs.rmSync(cached, { force: true });
  }
  const res = await fetch(kit.tarball);
  if (!res.ok) {
    throw new Error(
      `could not download "${kit.name}@${kit.version}": ` +
        `${res.status} ${res.statusText} from ${kit.tarball}`
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!kit.integrity && !kit.shasum) {
    throw new Error(
      `the registry published no checksum for "${kit.name}@${kit.version}" -- ` +
        `refusing to unpack bytes nothing vouches for`
    );
  }
  if (!verify(kit, bytes)) {
    throw new Error(
      `"${kit.name}@${kit.version}" does not match the checksum the registry ` +
        `published for it -- refusing to unpack it`
    );
  }
  fs.mkdirSync(cacheDir(), { recursive: true });
  // written via a temporary name so that two `markout restore`s running at
  // once cannot leave half a tarball behind for the next one to read
  const temp = `${cached}.${process.pid}.tmp`;
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, cached);
  return bytes;
}

/** `@scope/name@version` as one filesystem-safe name */
function cacheName(kit: KitVersion): string {
  return `${kit.name.replace(/[@/]/g, '_')}-${kit.version}.tgz`;
}

/**
 * Whether the bytes are the ones the registry published.
 *
 * These bytes become part of every page the author ships, and run on their
 * machine whenever they preview, so they are as trusted as anything else in
 * the project and are checked like it. `integrity` is the modern field; `shasum` is a sha1 that old packages
 * still carry, and is better than nothing on a tarball fetched over TLS.
 * Neither present is a refusal, made by the caller so that it can say which
 * of the two things went wrong.
 */
function verify(kit: KitVersion, bytes: Buffer): boolean {
  if (kit.integrity) {
    const [algorithm, expected] = kit.integrity.split('-');
    if (!algorithm || !expected) {
      return false;
    }
    try {
      return crypto.createHash(algorithm).update(bytes).digest('base64') === expected;
    } catch {
      return false;
    }
  }
  if (kit.shasum) {
    return crypto.createHash('sha1').update(bytes).digest('hex') === kit.shasum;
  }
  return false;
}
