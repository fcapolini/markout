# @markout-lang/express

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.5.0

### Patch Changes

- Follows [`@markout-lang/core@0.5.0`](../core/CHANGELOG.md), where `::` and
  `:const-` changed. Nothing in the middleware's own surface moved.

## 0.4.1

### Patch Changes

- Give served assets a cache lifetime, bounded by what they are not.
- Serve the runtime at a content-hashed URL, cacheable for a year.

## 0.4.0

Extracted from the CLI as a package of its own, so an Express application can
mount `markout()` without installing a command line. `express` is a **peer**
dependency: an application that mounts middleware already has one, and two
copies in a tree is its own kind of bug.

Note the ordering rule this release documented: a path with no extension is a
page request, so the middleware answers it — with a 404 when no page resolves
— rather than passing it on. An application's own API routes therefore have to
be registered **before** `markout()` is mounted.
