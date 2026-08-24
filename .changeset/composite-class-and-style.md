---
"@markout-lang/core": minor
---

`class+=` and `class-=`, and `style+=` and `style-=`: contribute to an
attribute instead of replacing it.

They are not `:` names, for the reason the rest are — `:` names what HTML has
no name for, and `class` has a name. What is new is the **operation**. Only
those two attributes have them, being the two HTML gives a *set* rather than
a value; a literal is read the way HTML spells that attribute, an expression
carries the value itself.

Nothing writes the attribute whole, which is what makes it hold: base, then
every addition, then every removal, whatever order they appear in, and only
the difference is applied. A class this page never put on — one Bootstrap's
own JS added to a modal it was handed — is in neither set and so is never
touched.

A usage site that writes a plain `class` on a component computing its own now
**warns**, and names `class+=` as what was probably meant.
