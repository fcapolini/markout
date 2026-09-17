# @markout-lang/bootstrap-kit

## 0.5.0

### Minor Changes

- a4da31f: An entry that acts is a `<button>`, and an entry that goes nowhere is not a
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

## 0.4.1

### Patch Changes

- `bs-link` and `bs-badge` no longer carry a leading/trailing space inside
  their rendered content.
  
  Both are `<:define>`d with `<:slot />` indented on its own line, so the
  definition's own template held a "\n    " text node before it and a
  "\n  " after — verbatim, since markout preserves whitespace and slot
  substitution removes only the `<:slot>` element itself, not its siblings.
  Invisible on a padded button, but `bs-link` used as a plain inline link
  rendered its underline a few pixels past the actual text, into that
  trailing space.
  
  `<:slot />` now sits on the same line as the surrounding tags, matching
  the convention `navbar.htm`'s brand link already used. No visible change
  to a button-styled `bs-link` or an ordinary `bs-badge`; a plain inline
  `bs-link`'s underline now ends where its text does.

## 0.4.0

### Minor Changes

- c86a69d: Colour modes are opt-in, with `<bs-theme-auto />`. A page that wants the
  system's light/dark preference asks for it; a page that does not is not given
  a theme switcher it never mentioned.
  
  Also: a checkbox group holds more than one box, and the scrollspy's band
  starts below the sticky bar rather than behind it.

### Patch Changes

- c86a69d: Warn when a page writes a value the user can take away from it.
  
  `value=${v}` on an input reads as "this is the value" and behaves as "this
  was the initial value": HTML's dirty flag makes the element's own state
  independent of both the attribute and the content from the first keystroke,
  so `v = ''` after a submit empties the model and leaves the typed text on
  screen.
  
  The fix is `:prop-value=${v}` **beside** the attribute — the attribute is
  what the element is served with, the property is what it shows afterwards —
  and the compiler now says so when it sees one without the other: `value` on a
  typed-in `<input>` and on a `<textarea>` (its content as well as its
  attribute), `checked` on an `<input>`, `selected` on an `<option>`.
  
  `value=` was deliberately **not** made to write the property when it happens
  to be on an input: that would be one attribute meaning two different things
  depending on the element it sits on.
  
  The warning found five in `bootstrap-kit`, all fixed: `bs-input`,
  `bs-textarea`, `bs-check`, `bs-range` and `bs-select` were read-write
  everywhere except the direction a form needs after a submit.

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.3.0

### Minor Changes

- Rewritten against
  [`@markout-lang/core@0.5.0`](https://github.com/fcapolini/markout/blob/main/packages/core/CHANGELOG.md): every
  component's parameters are declared and passed with `::`, and the kit's
  design tokens are `:const-` rather than `::`. A page using these components
  passes parameters the new way — see the migration note in core.

## 0.2.x

Bootstrap 5.3 as Markout fragments, published as a package rather than
vendored. How `markout.root` and `/npm/` resolve is in
[npm-kits.md](https://github.com/fcapolini/markout/blob/main/docs/design/npm-kits.md).
