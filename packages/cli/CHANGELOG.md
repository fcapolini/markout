# @markout-lang/cli

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.5.0

### Patch Changes

- Follows [`@markout-lang/core@0.5.0`](../core/CHANGELOG.md), where `::` and
  `:const-` changed. Read its migration note before upgrading a page.

## 0.4.1

### Patch Changes

- Say which version of Markout built the page.
- Check that the demos hydrate onto exactly what was served.

## 0.4.0

The package keeps the `markout` bin and gains an importable surface: `Server`
and `build` are available to a program that wants a server without the command
line.
