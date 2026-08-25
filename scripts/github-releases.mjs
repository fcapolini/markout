/**
 * Creates the GitHub Releases that `changeset publish` does not.
 *
 * Changesets tags -- `@markout-lang/cli@0.6.0` -- and stops there. A tag and
 * a Release are different objects: the tag is a pointer in this repository,
 * the Release is a record created through the API, with a title, a body and
 * an entry on the Releases page. Nothing created the second one for us,
 * which is why that page still ended at v0.1.4: those five were made by hand
 * in October 2025, and when releasing moved to Changesets the hand step went
 * away and nothing took its place.
 *
 * **Idempotent, which is what makes it usable for the backlog as well as for
 * the next release.** It asks GitHub which tags already have a Release and
 * skips them, so the workflow needs no before/after tag bookkeeping -- it
 * publishes, then runs this -- and running it by hand on a repository with a
 * dozen unreleased tags fills in every one of them.
 *
 *     node scripts/github-releases.mjs             # create what is missing
 *     node scripts/github-releases.mjs --dry-run   # say what it would create
 *
 * Needs `gh` authenticated: the GITHUB_TOKEN the workflow already has, or a
 * local `gh auth login`. Needs the tags fetched, hence the workflow's
 * `fetch-depth: 0`.
 *
 * ## Two tag shapes, because this repository has had two
 *
 * `name@version` is what Changesets cuts, one per package that moved. Its
 * body is that package's `CHANGELOG.md` section for that version -- the
 * prose the author already wrote and reviewed at `changeset version` time.
 * Re-deriving notes from commits would produce a second, worse account of
 * the same release, free to disagree with the first.
 *
 * `vX.Y.Z` is what this repository cut by hand up to 0.5.0: one tag for the
 * whole monorepo. **Which packages that covered is not written down
 * anywhere**, so it is recovered rather than guessed -- the packages whose
 * `package.json` version differs between the tag and the tag before it are
 * exactly the ones that release shipped, and the recovered lists agree with
 * what the release commits' own subjects say. Their bodies are those
 * packages' changelog sections, stacked.
 *
 * Except that for `v0.2.0` through `v0.3.0` there are none: `CHANGELOG.md`
 * arrived with Changesets at 0.4.0, and no file at those tags holds release
 * notes. Those Releases get the version list and a compare link and say so.
 * A Release that admits it has no notes is worth more than one carrying
 * notes invented four months late.
 *
 * ## Only the CLI is marked latest
 *
 * GitHub picks "Latest" by reading semver out of the tag name, which with
 * per-package tags means four candidates for one release and an arbitrary
 * winner -- and with the old `vX.Y.Z` tags backfilled alongside them, a
 * `v0.5.0` that outranks `@markout-lang/core@0.6.0` on a plain version
 * compare. So nothing is left to that rule: every Release is created
 * `--latest=false` except the CLI's, which is the package a reader arriving
 * at this repository installs.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const REPO = 'fcapolini/markout';
/** The Release the Releases page should open on. See the header. */
const LATEST = '@markout-lang/cli';

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
// stderr is dropped: `versionAt` asks about paths that legitimately do not
// exist at older tags, and git says so loudly on every one of them.
const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * Every releasable workspace package, by the name its tags are cut under.
 *
 * `sites/*` is left out. It is versioned -- `privatePackages.version: true`
 * in the changesets config, because it is where a stale internal range would
 * bite -- but it is a demo rather than a deliverable, and listing it in
 * release notes would advertise something nobody can install. The extension
 * under `packages/` is private too and stays in: it ships, to the
 * Marketplace.
 */
function workspaces() {
  const { workspaces: patterns } = JSON.parse(readFileSync('package.json', 'utf8'));
  const found = new Map();
  for (const pattern of patterns) {
    if (pattern.startsWith('sites/')) continue;
    // every remaining pattern is `dir/*`; anything else would need a globber
    const parent = pattern.replace(/\/\*$/, '');
    for (const entry of readdirSync(parent)) {
      const dir = join(parent, entry);
      if (!existsSync(join(dir, 'package.json'))) continue;
      found.set(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name, dir);
    }
  }
  return found;
}

/**
 * The one `## <version>` section of a CHANGELOG, without its heading.
 *
 * A section ends at the next *version* heading rather than the next `##` of
 * any kind: core's 0.5.0 notes contain a `## Migrating from 0.4.x` of their
 * own, and cutting there would drop the migration guide from the release
 * that needs it. Returns null when there is no such section, which for
 * anything before 0.4.0 is every time.
 */
function changelogSection(dir, version) {
  const path = join(dir, 'CHANGELOG.md');
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## \d/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim() || null;
}

/** A package's version at a tag, or null if it did not exist there. */
function versionAt(tag, dir) {
  try {
    return JSON.parse(git(['show', `${tag}:${dir}/package.json`])).version;
  } catch {
    return null;
  }
}

const packages = workspaces();

const remoteTags = gh(['api', `repos/${REPO}/tags`, '--paginate', '--jq', '.[].name'])
  .split('\n')
  .filter(Boolean);

const released = new Set(
  gh(['release', 'list', '--limit', '200', '--json', 'tagName', '--jq', '.[].tagName'])
    .split('\n')
    .filter(Boolean),
);

const asNumbers = (v) => v.split('.').map(Number);
const bySemver = (a, b) => {
  const [x, y] = [asNumbers(a.version), asNumbers(b.version)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

// `name@version`: the leading `@` of a scoped name is why the separator is
// matched from the end.
const packageTags = remoteTags
  .map((tag) => {
    const at = tag.lastIndexOf('@');
    return at > 0 ? { tag, name: tag.slice(0, at), version: tag.slice(at + 1) } : null;
  })
  .filter((it) => it && packages.has(it.name));

// `vX.Y.Z`, oldest first: each one's body needs the tag before it.
const repoTags = remoteTags
  .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
  .map((tag) => ({ tag, version: tag.slice(1) }))
  .sort(bySemver);

/** The body of a per-package Release: that package's changelog section. */
function packageBody({ name, version }) {
  return changelogSection(packages.get(name), version);
}

/**
 * The body of a repo-wide Release: what moved, and each mover's notes.
 *
 * `previous` is null for the oldest tag we backfill, which then has nothing
 * to diff against and reports no packages -- true of nothing here, since
 * v0.1.4 predates this scheme and already has a Release.
 */
function repoBody({ tag, version }, previous) {
  const moved = [];
  for (const [name, dir] of packages) {
    const now = versionAt(tag, dir);
    if (!now) continue;
    if (previous && versionAt(previous.tag, dir) === now) continue;
    moved.push({ name, dir, version: now });
  }

  const notes = moved
    .map(({ name, dir, version: v }) => {
      const section = changelogSection(dir, v);
      return section && `## ${name}@${v}\n\n${section}`;
    })
    .filter(Boolean);

  const parts = [];
  parts.push(moved.length
    ? `**Released:** ${moved.map((m) => `\`${m.name}@${m.version}\``).join(', ')}`
    : '**Released:** could not be recovered from this tag.');

  if (notes.length === 0) {
    parts.push(
      `This release predates \`CHANGELOG.md\` in this repository, which arrived with ` +
      `Changesets at 0.4.0, so there are no written notes for it. The commits are the record.`,
    );
  }

  if (previous) {
    parts.push(`**Commits:** [\`${previous.tag}...${tag}\`](https://github.com/${REPO}/compare/${previous.tag}...${tag})`);
  }

  return [...parts, ...notes].join('\n\n');
}

const work = [
  ...repoTags.map((it, i) => ({ ...it, body: () => repoBody(it, repoTags[i - 1] ?? null) })),
  ...packageTags.map((it) => ({ ...it, body: () => packageBody(it) })),
].filter((it) => !released.has(it.tag));

if (work.length === 0) {
  console.log('nothing to do: every tag this script knows about already has a Release');
  process.exit(0);
}

for (const { tag, name, body } of work) {
  const notes = body();
  if (notes === null) {
    console.log(`${tag}: no changelog section, releasing with an empty body`);
  }
  if (dryRun) {
    console.log(`\n--- would create ${tag} (latest: ${name === LATEST}) ---`);
    console.log(notes ?? '(empty)');
    continue;
  }
  gh([
    'release', 'create', tag,
    '--title', tag,
    '--notes', notes ?? '',
    name === LATEST ? '--latest' : '--latest=false',
  ]);
  console.log(`created ${tag}`);
}
