# Directive Reference

This page is a compact summary of the main Markout directives and special tag
forms.

## Value and binding directives

| Syntax | Meaning |
| --- | --- |
| `:name=${expr}` | Declares a reactive value on the current scope. |
| `:aka="name"` | Names the current scope so descendants can reference it. |
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

## Notes

- `${...}` is the only expression syntax.
- The compiler is responsible for qualification and dependency extraction.
- The runtime executes the generated graph; it does not discover dependencies on
  its own.
