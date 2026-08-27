# @markout-lang/express

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
  - @markout-lang/core@0.6.1

## 0.6.0

### Minor Changes

- f325592: Export `isPageRequest` — markout's own rule for what a page request is, so a
  rate limiter in front of the pages can agree with the middleware behind them.
  
  The rule (an extensionless path, or a `.html` one) was spelled twice: inline
  in the middleware, and again in the CLI's `Server` for its `pageLimit`, whose
  comment named the hazard — "the two disagreeing would mean a request that
  costs a render and is not counted, or an image that is". A third copy was
  about to be written for the site.
  
  It is one definition now, in the module that owns the rule, and both callers
  import it.

### Patch Changes

- caabb94: A directory redirect names a path on this origin, whatever was asked for.
  
  `GET //demos` reaches the same directory — the resolver joins it to the same
  place — and the `301` echoed the requested path back into `Location`, making
  it protocol-relative: a browser reads `//demos/` as `http://demos/` and
  leaves the site.
  
  Only reachable for a name that IS a directory in the docroot, so it is not an
  open redirect to anywhere an attacker chooses. It is still a redirect off the
  origin that this server had no reason to issue, and CodeQL was right to flag
  it (`js/server-side-unvalidated-url-redirection`).
  
  The `Location` is the **resolver's** pathname now, never the request's —
  `Resolution.pathname` is the file's one logical identity, arrived at by the
  same normalization that decided which file to stat, so there is nothing of
  the request left in it to be tricked by. `/demos`, `//demos` and `///demos`
  all redirect to `/demos/`.
  
  Built from the request first, with the leading slashes collapsed by hand.
  That closed the reported case and not `/\demos`, which some browsers read
  the same way — a sanitizer bolted onto user input, answering the example
  rather than the class.
- Updated dependencies [523ef5e]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [5642d62]
- Updated dependencies [a4f641f]
- Updated dependencies [bd33a54]
  - @markout-lang/core@0.6.0

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.5.0

### Patch Changes

- Follows [`@markout-lang/core@0.5.0`](https://github.com/fcapolini/markout/blob/main/packages/core/CHANGELOG.md), where `::` and
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
