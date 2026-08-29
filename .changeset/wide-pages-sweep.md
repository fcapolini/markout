---
'markout-vscode': minor
---

Sweep 2000 pages of a workspace, not 200, and let a project say otherwise
with `markout.maxPages`.

The Problems panel is answered for the whole project, which means compiling
the whole project, so there is a bound on it. Where the bound sat was
guessed, and the guess was wrong by an order of magnitude: an ordinary page
compiles in about 2ms and one that imports a kit in about 20ms, so 200 pages
was half a second. It stopped in the repository markout itself is developed
in -- 213 pages, and not a large project -- and warned about it every time
the panel was pulled. A kit ecosystem makes several hundred pages of
components an ordinary thing to have.

The new default is 2000, which is a few seconds of the slowest kind of page.
`markout.maxPages` moves it in either direction, live, in the window it is
changed in; `0` removes it entirely. The notification that the sweep stopped
early now names the setting, because a warning about a limit that does not
say which limit leaves nothing to do about it.
