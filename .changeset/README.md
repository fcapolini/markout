# Changesets

This directory holds the release intents that have not shipped yet, one file
per change, plus the configuration in `config.json`.

**Why the tool is here at all** is in
[docs/design/monorepo.md](../docs/design/monorepo.md), and it is not
convenience. npm leaves a sibling's version range untouched when you bump a
package, and then resolves the stale range **from the registry without saying
so** — so a release cut by hand can build green against code nobody in this
repository wrote. 0.3.0 was cut by editing five `package.json` files, four of
which were versions; the fifth was the site's range on the middleware, and
nothing would have reported it.

The flow, and it is three commands:

```sh
npm run changeset          # describe what changed, and how far it moves
npm run version-packages   # apply them: versions, ranges, CHANGELOG.md
npm run release            # build, then publish what moved
```

`npm run changeset` asks which packages moved and whether each move is a
patch, a minor or a major, then writes a markdown file here. Commit it with
the change it describes — that is the point of the file existing separately
from the version number.

## Links in a changeset are read somewhere else

Write them **absolute**, `https://github.com/fcapolini/markout/blob/main/...`,
not relative.

A changeset lives in `.changeset/` and its text ends up in a package's
`CHANGELOG.md`, so a relative path is wrong by however many directories
apart those are -- caught the first time by the docs-link check, on a
`../docs/reference/testing.md` that was right where it was written and one
level short where it landed.

The deeper reason is the one the check cannot see: a changelog's main reader
is on **npm**, where there is no repository around it and no relative link
resolves at all.

## What the configuration decides, and why

- **`updateInternalDependencies: "patch"`** is the whole reason for the tool.
  A sibling's range is rewritten whenever the thing it points at moves, so
  the stale-range failure cannot happen.
- **`privatePackages.version: true`** keeps [the site](../sites/site/) and
  [the extension](../packages/vscode/) in the versioning pass without
  publishing either. The site is where the stale range actually bit, so it
  has to be in; the extension goes to the Marketplace with `vsce` and must
  never go to npm, which its own `prepublishOnly` also refuses.
- **`onlyUpdatePeerDependentsWhenOutOfRange: true`** is not optional here.
  The kits declare `@markout-lang/core` as a *peer* dependency, and by
  default a peer dependency moving at all bumps its dependents as **major**.
  Both kits would go major every time core took a patch, which is a lie about
  what changed.

  It is only half the answer, and the other half is in the kits' own
  `package.json`. Their peer range is `>=0.5.0 <1.0.0` rather than `^0.5.0`,
  because in a 0.x version `^` does not span minors: core going to `0.6.0`
  puts it outside `^0.5.0`, the peer dependents go out of range, and both
  kits are bumped to **1.0.0** — arriving at a stability claim nobody made,
  and one that says the kit is further along than the language it is written
  in. The wide range is the true statement instead: a kit works with any 0.x
  core from 0.5 on, which this repository verifies every release by building
  and testing them together. Revisit it at 1.0, when `^` starts meaning what
  the tool assumes it means.
- **`changelog: "@changesets/cli/changelog"`**, not the GitHub one. The
  GitHub changelog links each entry to the pull request that carried it, and
  wants a token at version time to do it. This repository's history is
  commits on `main` rather than pull requests, so the links would mostly be
  to nothing and the token would be a release-time dependency bought for it.
