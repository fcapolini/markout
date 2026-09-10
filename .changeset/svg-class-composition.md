---
"@markout-lang/core": patch
---

Two fixes to composed `class` and `style`, both of which an icon component
runs into on its first day.

**A class never reached an `<svg>`, and said so in the console.** The class
machinery read what was already on an element through `className`, which is
HTML's property alone: on an SVG element the DOM answers with an
`SVGAnimatedString`, so the read was handed an object and threw `.split is
not a function`. It surfaced as a `[callback]` error in the browser and
nowhere else — a `ServerElement`'s `className` really is a string, so the
served page was correct and only the first update failed, which is what made
it read like "`class` rejects something it accepts everywhere else". Read
through `getAttribute('class')`, which means the same thing on an HTML
element, an SVG one, and the server's own. `className` is gone from the
shared `dom.Element` interface so nothing isomorphic can reach for it again.

**A `class` that computes to nothing blocked everything else that had a
say.** A `class=${...}` claims the base its contributions sit on, and until
it landed nothing was applied. But it lands from a callback, a callback runs
on a CHANGE, and `class=${extra}` whose expression answers `null` answers the
same `null` it started at — so it never ran, and the base stayed claimed for
the life of the page. Every `class+=`, every `:class-x`, and a `<:mode>`'s
paint were dropped on the floor, server and browser alike:

```html
<:define tag="ui-icon:svg" ::extra=${null} class=${extra}>…</:define>
<ui-icon class+="w-6" />   <!-- served without the class -->
```

The base is now asked for rather than waited on: whatever the value holds at
the moment a contribution arrives is the base. `style=${...}` had the same
shape and is fixed with it.
