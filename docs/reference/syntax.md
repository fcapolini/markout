# Syntax Reference

The whole language on one page: what interpolation means, every `:` family,
the module and composition tags, and the names the runtime supplies.

## Interpolation

| Syntax | Meaning |
| --- | --- |
| `${expr}` in text | Reactive text content. |
| `${expr}` in CSS | Reactive stylesheet content. |
| `attr=${expr}` | Reactive plain attribute; no `:` needed. `null`/`undefined` removes it. |

### Attribute values and quoting

An attribute value can be unquoted, `"double quoted"` or `'single quoted'`,
and any of them may contain `${...}`. What quoting does *not* do is decide
the type — that depends on whether an expression fills the value on its own:

| Written | Result |
| --- | --- |
| `:x=${expr}` | the expression's value, whatever its type |
| `:x="${expr}"` | identical: quoting changes nothing here |
| `:x='${expr}'` | identical |
| `:x="text ${expr}"` | interpolation — always a string |
| `:x="${a}${b}"` | interpolation — always a string |
| `:x="literal"` | the string `literal` |

So a lone expression is passed through with its type intact — object, array,
number, boolean, function — while anything combining literal text with
expressions, or more than one expression, is assembled into a string.

That distinction matters most for `:prop-`, where a component is expecting
something an attribute could never carry:

```html
<sl-select :prop-options="${items}"      <!-- the array itself -->
           :prop-label="Pick one of ${items.length}">   <!-- a string -->
```

NOTE: "on its own" is literal — whitespace is text like any other, so
`:x=" ${expr}"` interpolates and yields a string.

## Values

| Syntax | Meaning |
| --- | --- |
| `:name=${expr}` | Declares a reactive value on the current scope. |
| `:aka="name"` | Names the current scope so descendants can reference it. |
| `:attr-name=${expr}` | Toggles whether attribute `name` is PRESENT, as boolean and custom-element attributes need. Bare `:attr-name` implies `true`. |
| `:prop-name=${expr}` | Assigns the element's JS property `name`, for what an attribute can't carry. Browser-only: skipped when server rendering. |
| `:class-name` | Toggles the `name` CSS class. |
| `:style-name` | Writes the `name` CSS property. |
| `:on-click=${() => ...}` | Binds an event handler. |
| `:did-init=${() => ...}` | Runs a lifecycle callback when the scope reaches a phase. |
| `:will-dispose=${() => ...}` | Runs a lifecycle callback before teardown. |

The three callback families take a **literal arrow function**, written at
that spot. A classic `function` is refused because it would rebind `this`,
which is how the surrounding scope is reached; and for now a reference to
one is refused too, so `${handler}` is an error even where `handler` holds a
function:

```html
<button :on-click=${() => count++}>          <!-- yes -->
<button :on-click=${async () => save()}>     <!-- yes: still an arrow -->
<button :on-click=${handler}>                <!-- error -->
<button :on-click=${function () { ... }}>    <!-- error -->
```

The ban on classic functions is wider than these three: one may not appear
anywhere inside any `${...}`, for the same reason.

## Comments inside a tag

Between the attributes of an opening tag, `//` comments to end of line and
`/* … */` block comments are both allowed. They are stripped at parse time
and never reach the served markup.

That matters more than it sounds, because attributes may also span lines. A
tag declaring a handful of values stops being a long line to scan and
becomes something closer to a declaration, with its parts grouped and
labelled:

```html
<div class="my-component"

     // parameters
     :width=${100}

     // private
     :_w="${width}px"

>${_w}</div>
```

Commenting out a single attribute works the way it does in code — the
comment simply hides it from the parser. One left unterminated runs to the
end of the file, which shows up as the enclosing tag never being closed
(`Unterminated tag DIV`) rather than as anything about comments.

These belong to a tag. In text content they are ordinary text; use
`<!-- … -->` there.

> The leading underscore is a convention meaning "private" — a value the
> component uses but no caller should set. Nothing in the language treats
> `_` specially; it reads as private to a person, not to the compiler.

## Replication

| Syntax | Meaning |
| --- | --- |
| `:for-each=${expr}` | Repeat once per item in an iterable. `null`/`undefined` means zero items. |
| `:for-as="name"` | Rename the per-item binding from the default `data`. |
| `:for-key=${expr}` | Give each item an identity, so reordering moves replicas instead of rewriting them. Evaluated per item, and may read the per-item binding. |
| `:for-data=${expr}` | Optional single-item rendering. Designed, **not implemented** — a compile error today. |

## Modules and components

| Syntax | Meaning |
| --- | --- |
| `<:include src="file.htm" />` | Splices another file into the current document. |
| `<:include src="file.txt" as="pre" />` | Includes a file as a literal element named `pre` containing its text. |
| `<:import src="file.htm" />` | Splices a fragment into the page; each file is only imported once per page. |
| `<:define tag="x-y:button">...</:define>` | Declares a reusable custom tag. |
| `<:slot />` | In a definition: where a usage site's content goes. Its own content is the fallback. |
| `<:slot name="x" />` | A named slot. |
| `:slot="x"` | On a usage site's child: which slot it fills. Unaddressed content fills the unnamed one. |

## Default scope names

`<html>`, `<head>` and `<body>` always have scopes of their own, named
`page`, `head` and `body`, so shared state has an obvious home that any
descendant can read.

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
