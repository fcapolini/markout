# What the platform actually does

Status: **living.** Facts about Node, the DOM and the filesystem that cost
somebody a debugging session to establish, and that no amount of reading the
documentation would have produced.

Each of these was measured rather than reasoned about, and each has already
been rediscovered at least once in a different corner of the repository —
which is why they are here rather than in the comment beside the code that
first needed them. A comment explains the line it sits on; it does not reach
the next person writing the same bug two packages away.

The rule for adding one: it belongs here if it is a fact about something the
project does not control, if getting it wrong produces a plausible-looking
failure rather than an obvious one, and if the corrective is not what the
obvious reading suggests.

## `fs.watch` is not armed when it returns

A write in the window between `fs.watch()` returning and the watcher actually
being established produces **no event at all** — not a late one, none. So a
test that starts a server, writes a file on the next line, and then waits is
not slow-and-flaky, it is waiting for something that will never arrive.

A longer timeout cannot fix it, and the reason is worth holding onto: no
timeout distinguishes "not notified yet" from "never going to be". The
corrective is to repeat the **change**, not to extend the **wait** — which is
also the only thing that tells a broken watcher apart from an unready one.

Vary what each attempt writes. Identical bytes are a weaker event than
different ones, and a platform that coalesces can deliver two writes of the
same content as none.

Established in
[`packages/express/test/watcher.test.ts`](../../packages/express/test/watcher.test.ts),
which measures it directly. Then rediscovered in
`packages/cli/test/server/error-pages.test.ts`, which had been hardened once
by lengthening its poll and went on failing about one full-suite run in five;
the shared helper it now uses is
[`packages/cli/test/server/eventually.ts`](../../packages/cli/test/server/eventually.ts).

## `.d-flex` beats a display rule Bootstrap relies on

Bootstrap's utilities are `!important`, so `.d-flex` on an element whose
visibility depends on `display` overrides that rule permanently. A `.toast`
is hidden by `.toast:not(.show) { display: none }`, so a toast carrying
`d-flex` never hides again.

This is why Bootstrap's own headerless-toast markup puts the flex container on
an inner wrapper rather than on the toast, and why
[`bs-toast`](../../kits/bootstrap-kit/parts/toast.htm) does the same. The
general form: a layout utility and a visibility rule cannot share an element
when the utility is `!important` and the rule is not.

## Bootstrap emits `justify-content-end` before `justify-content-between`

Its utilities are generated in the order `start, end, center, between, around,
evenly`, all at equal specificity, so source order decides. An element
carrying both `justify-content-between` and `justify-content-end` gets
`space-between`.

So a conditional justification has to **swap** the class, not add to it.
Adding looks right, reads right, and quietly does nothing — the failure is a
single flex item sitting at the start of a row where the intent was the end.

## An HTML formatter cannot be trusted with a markout file

VS Code's HTML formatter (js-beautify) reads the raw text, so the `>` in
`:_class=${['a'].filter(s => s)}` ends the tag for it: it closes the tag there
and every attribute after it becomes text content. `// parameters` in a
definition's attribute list comes back as two attributes.

That is a different document, not a differently indented one — which is why
[the extension](../../packages/vscode/src/formatting.ts) provides formatting
of its own and takes HTML's away, rather than declining to compete with it.

The Volar detail that goes with it, since it is not in any documentation:
dropping `documentFormattingProvider` from a plugin's capabilities is not
enough. Volar gates *on-type* formatting on the capability but calls
`provideDocumentFormattingEdits` on every plugin that has one, taking the
first answer. The capability decides what the server advertises; the method
has to be removed from the instance too.

And the reason a provider can look correct and never run: Volar skips any
virtual code one of whose children covers the same range. A markout page's
masked HTML covers all of it, so the root code — which every other feature in
that extension answers on — is never offered for formatting at all.
