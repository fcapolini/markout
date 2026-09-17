---
"@markout-lang/bootstrap-kit": minor
---

An entry that acts is a `<button>`, and an entry that goes nowhere is not a
link.

Six of the list-driven components wrote every entry as an `<a>` and dropped
the `href` when there was nothing to navigate to — `href=${item.link ??
null}`. That renders correctly, which is why it lasted: an anchor with no
`href` is inert and looks exactly like the entry beside it.

It is not inert to anything that is not a mouse. An anchor without an `href`
takes no focus and reaches the accessibility tree with no role, so an entry
whose whole behaviour was `select` could be triggered by a click and by
nothing else. A `bs-pagination` driven by `::select` — the mode a page that
never reloads uses, and the default — was a control no keyboard could reach.
A `bs-dropdown` item with a `select` and no `link` was the same.

Each component now picks the element from what the entry does:

- `bs-dropdown` — `<a href>` with a `link`, `<button>` without. Disabled
  items carry the real `disabled` attribute rather than the class alone, so
  they leave the tab order too.
- `bs-pagination` — `<a href>` when `::link` yields one, `<button>` when only
  `::select` is given. Dead arrows are `disabled` rather than greyed.
- `bs-nav`, `bs-navbar` — `<a href>` with a `link`, `<span>` for an entry
  that is a label among the links. (A `::toggle`-ing nav already rendered
  buttons.)
- `bs-list-group` — `<a href>` with a `link`, `<div>` without.
  `.list-group-item-action` now lands only on the element that can take
  focus.
- `bs-breadcrumb` — the current crumb is its text, with no `<a>` around it,
  which is Bootstrap's own markup for it.

Minor rather than patch because the rendered element changes for usages that
were already written: a stylesheet or a `querySelector` reaching for these by
tag name rather than by class will need the other element too. Bootstrap
styles `.dropdown-item`, `.page-link` and `.nav-link` on all of them, so
nothing changes visually.

One thing to know if you use Bootstrap's scrollspy with `bs-nav`: it follows
`href`, so the entries it highlights must have a `link`. They did before as
well — an entry without one was never a scrollspy target — but the markup no
longer suggests otherwise.
