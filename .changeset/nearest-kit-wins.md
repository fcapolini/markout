---
"@markout-lang/core": minor
"@markout-lang/cli": patch
"@markout-lang/express": patch
---

Two copies of one kit: the nearer one wins, instead of both being refused.

Every other refusal in kit discovery is `ln -s` failing because the name is
taken, and holds. This one was different and it took a while to see: there is
one thing to link and only the question of which copy of it, so the link
succeeds whichever you pick. The refusal was answering a question nobody had
asked, and it refused the whole build.

**Nearer** means the walk that already exists — `.markout/kits` then
`node_modules`, at the docroot and at every directory above it, and after all
of those the private tree of each kit those rungs yielded. That last clause is
the part with teeth: a kit's own dependencies are appended to the queue rather
than descended into as it is accepted, so a hoisted copy beats a nested one
however the directories happen to sort. Which of the two won used to be
whichever `readdir` reached first.

**When the two versions differ, it says so** — on a channel of its own,
`Discovery.shadowed`, printed by the CLI and logged by the middleware at
startup, failing nothing:

```
markout: kit "@markout-lang/std-kit" 0.4.0 at "~/.markout/kits/@markout-lang/std-kit"
  is not used: 0.3.0 at "/app/node_modules/@markout-lang/std-kit" is nearer the docroot
```

Two copies at one version pass without a word, that being what an npm tree
looks like on any ordinary day.

**What sent us here.** `markout add` run in a home directory leaves a
`~/.markout/kits`, and the walk runs from the docroot to `/` — so that
directory is a rung for every project on the machine, and every one of them
that had installed the same kit with npm refused to build. The rung is
per-project by design; nothing stops one being created above every project at
once.

Two kits claiming one root is unchanged, and so is the `alsoFrom` gate: a tree
**above the project** is on the docroot's own walk and falls back per kit,
while the **compiler's own** install tree stays all-or-nothing. That tree
belongs to whoever installed the compiler rather than to the project, and
taking it always would let a docroot built by a CLI inside a monorepo silently
gain that monorepo's kits.
