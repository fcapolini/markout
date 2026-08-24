---
"@markout-lang/core": patch
---

Bind a catch clause's parameter for its body.

`try { … } catch (err) { report(err) }` inside a handler failed to compile
with `Unknown reference: "err"`. The clause's parameter was recognised as a
binding, but the walk deciding whether a later *use* of a name refers to a
local never asked about a catch clause — so the name was bound and then not
found, on JavaScript that is simply correct.

`catch ({ message })` binds through the pattern, and `catch { }` binds
nothing.
