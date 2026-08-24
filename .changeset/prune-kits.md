---
"@markout-lang/cli": minor
---

`markout build --prune-kits` drops an installed kit's files when no built
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
