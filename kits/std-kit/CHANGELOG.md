# @markout-lang/std-kit

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.3.0

### Minor Changes

- Rewritten against
  [`@markout-lang/core@0.5.0`](https://github.com/fcapolini/markout/blob/main/packages/core/CHANGELOG.md):
  `std-data`'s parameters are declared and passed with `::`.

## 0.2.x

`std-data`, the datasource component — a value whose contents are fetched
rather than written down, computed while the page renders and carried to the
browser with it. A component rather than a language feature, which is the
point: [kits carry the framework layer](https://github.com/fcapolini/markout/blob/main/docs/concepts/kits.md).
