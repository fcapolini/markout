---
"markout-vscode": patch
---

Say which tree the kits were read from, and stop swallowing the refusals.

An unresolved tag reads the same whichever way a kit went missing, and the
ways are not guessable from the page. A project with any kit of its own never
consults the global tree, deliberately, so that a stray global copy cannot
break a real project -- which means a globally installed kit is invisible in
any project that has one of its own, correctly and silently. A machine with
two npms has two global trees, only one of which holds what was installed.
Both end in "no such tag", with nothing said anywhere about the directory
that was actually read.

The kit scan now reports what it did, once per distinct answer, to the
Markout output channel: how many kits came from the project, or the global
tree it read and what it found there, or that npm could not be reached and
the login shell is being asked. It is background rather than a diagnostic --
it is not a fault in the page being edited, and it is only wanted by someone
already asking where their kit went.

Kit refusals are the exception. `discoverKits` returns them as complete
sentences -- a root claimed twice, a root shadowed by a real directory -- and
the extension was discarding them, so a kit that was found and rejected
produced a page full of unresolvable tags and no explanation at all. Those
are now surfaced where they will be read.
