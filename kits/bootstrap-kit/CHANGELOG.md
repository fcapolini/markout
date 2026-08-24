# @markout-lang/bootstrap-kit

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.3.0

### Minor Changes

- Rewritten against
  [`@markout-lang/core@0.5.0`](../../packages/core/CHANGELOG.md): every
  component's parameters are declared and passed with `::`, and the kit's
  design tokens are `:const-` rather than `::`. A page using these components
  passes parameters the new way — see the migration note in core.

## 0.2.x

Bootstrap 5.3 as Markout fragments, published as a package rather than
vendored. How `markout.root` and `/npm/` resolve is in
[npm-kits.md](../../docs/design/npm-kits.md).
