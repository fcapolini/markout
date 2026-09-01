---
'@markout-lang/core': patch
---

A render now settles instead of answering with whatever it happened to see.

A scope's own values are evaluated before its children exist, so anything a
child wrote to its `$host` while rendering landed after the pass had already
walked the readers that should have moved. Those readers were marked dirty but
nothing walked them again, so the write reached its direct readers and nothing
derived from them — leaving a page that could contradict itself in a single
render, with two readers of one value disagreeing.

`refresh()` now walks again to carry a mid-render write, and keeps walking
until a pass changes nothing. Only when something was actually written: a
render nobody writes to during costs exactly the one walk it always did. A page
that never settles reports it after 8 passes rather than hanging.
