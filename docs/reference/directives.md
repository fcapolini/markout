# Directive Reference

This page is a compact summary of the main Markout directives and special tag
forms.

## Interpolation

| Syntax | Meaning |
| --- | --- |
| `${expr}` in text | Reactive text content. |
| `${expr}` in CSS | Reactive stylesheet content. |
| `attr=${expr}` | Reactive plain attribute; no `:` needed. `null`/`undefined` removes it. |
| `:attr-name=${expr}` | Toggles whether attribute `name` is PRESENT, for boolean/custom-element attributes. |
| `:prop-name=${expr}` | Assigns the element's JS property `name`, for what an attribute can't carry. Browser-only. |

## Value and binding directives

| Syntax | Meaning |
| --- | --- |
| `:name=${expr}` | Declares a reactive value on the current scope. |
| `:aka="name"` | Names the current scope so descendants can reference it. |
| `:attr-name` | Toggles the presence of attribute `name` (see above). |
| `:prop-name=${expr}` | Assigns an element property; skipped when server rendering. |
| `:class-name` | Toggles the `name` CSS class. |
| `:style-name` | Writes the `name` CSS property. |
| `:on-click=${fn}` | Binds an event handler. |
| `:did-init=${fn}` | Runs a lifecycle callback when the scope reaches a phase. |
| `:will-dispose=${fn}` | Runs a lifecycle callback before teardown. |

## Replication directives

| Syntax | Meaning |
| --- | --- |
| `:for-each=${expr}` | Repeat once per item in an iterable. `null`/`undefined` means zero items. |
| `:for-as="name"` | Rename the per-item binding from the default `data`. |
| `:for-key=${expr}` | Reserved for keyed reconciliation. |
| `:for-data=${expr}` | Planned optional single-item rendering primitive. |

## Module directives

| Syntax | Meaning |
| --- | --- |
| `<:include src="file.htm" />` | Splices another file into the current document. |
| `<:include src="file.txt" as="pre" />` | Includes a file as a literal element named `pre` containing its text. |
| `<:import src="file.htm" />` | Splices a fragment into the page; each file is only imported once per page. |
| `<:define tag="x-y:button">...</:define>` | Declares a reusable custom tag. |
| `<:slot />` | In a definition: where a usage site's content goes. Its own content is the fallback. |
| `<:slot name="x" />` | A named slot. |
| `:slot="x"` | On a usage site's child: which slot it fills. Unaddressed content fills the unnamed one. |

## Runtime-supplied values

Available on every scope; not declared, and reserved from user code.

| Name | Meaning |
| --- | --- |
| `$id` | This scope's identifier, unique in the page. For building HTML ids. |
| `$parent` | The enclosing scope. |
| `$value("key")` | Looks a value up by key. |

## Notes

- `${...}` is the only expression syntax, and anything containing one is
  reactive — `:` names things HTML has no name for, rather than marking
  reactivity by itself.
- An expression resolves where it was WRITTEN. A definition's body sees the
  definition's scope; a usage site's attributes and slotted content see the
  call site.
- The compiler is responsible for qualification and dependency extraction.
- The runtime executes the generated graph; it does not discover dependencies on
  its own.
