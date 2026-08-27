# @markout-lang/cli

## 0.6.1

### Patch Changes

- 88ff5c1: Carry the `/npm/<package>` fix for globally installed kits.
  
  Both build a `Resolver` of their own -- `build.ts` for the compiled artifact,
  the middleware for a served request -- so both refused
  `<:import src="/npm/@markout-lang/bootstrap-kit/all.htm" />` against a kit
  that was installed globally and mounted correctly. The fix is core's; these
  are versioned so that the range they declare on it moves too, and a project
  that bumps only the CLI actually receives the fix rather than resolving a
  locked 0.6.0 that still has the bug.
- Updated dependencies [88ff5c1]
- Updated dependencies [88ff5c1]
  - @markout-lang/express@0.6.1
  - @markout-lang/core@0.6.1

## 0.6.0

### Minor Changes

- 085ede4: `markout build --prune-kits` drops an installed kit's files when no built
  page mentions its root (#27).
  
  A build materializes every *installed* kit, whether or not a page imported
  it — the same rule the dev server mounts by, so the two cannot disagree about
  whether a kit's resource exists. Correct, and it leaves the deliverable
  holding directories the author never named.
  
  **Mentions, not imports**, which is the whole point: a page writing
  `<img src="/some-kit/res/logo.png">` and importing nothing still needs those
  files, and import-derived pruning would work in dev and 404 once built — the
  trap the installed-not-imported rule exists to close. What is read is the
  rendered output of every page, so a root the page computed counts too.
  
  Opt-in, and staying opt-in: it can only see what a page rendered, so a URL
  built in the browser is invisible to it. Nothing is pruned when the evidence
  is incomplete either — a page that failed to compile, or a build restricted
  with `--page`, means the unseen pages might have mentioned anything.
  
  The build says which kits it dropped, and says so when it dropped none.

### Patch Changes

- Updated dependencies [523ef5e]
- Updated dependencies [caabb94]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [5642d62]
- Updated dependencies [f325592]
- Updated dependencies [a4f641f]
- Updated dependencies [bd33a54]
  - @markout-lang/core@0.6.0
  - @markout-lang/express@0.6.0

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.5.0

### Patch Changes

- Follows [`@markout-lang/core@0.5.0`](https://github.com/fcapolini/markout/blob/main/packages/core/CHANGELOG.md), where `::` and
  `:const-` changed. Read its migration note before upgrading a page.

## 0.4.1

### Patch Changes

- Say which version of Markout built the page.
- Check that the demos hydrate onto exactly what was served.

## 0.4.0

The package keeps the `markout` bin and gains an importable surface: `Server`
and `build` are available to a program that wants a server without the command
line.
