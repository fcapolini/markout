HTML-first reactive web framework, aiming at presenting developers with the
equivalent of a natively modular and reactive HTML.

## Design philosophy

The objective is to remove as much needless complexity as possible from
reactive web development. The whole language is meant to stay a handful of
rules:

- `${...}` is the only interpolation syntax, in attributes, text and CSS:
  it's plain JavaScript, no separate expression language to learn.
- `:` marks anything compiled/reactive, on tags or attributes; everything
  else is plain HTML.
- `:name=${expr}` on a tag declares a reactive value in that tag's scope.
- `:on-x` binds an event, `:class-x` toggles a CSS class (presence implies
  `true`), always the same way.
- `:for-each=${expr}` repeats a tag once per element (`null`/`undefined`
  means zero, any other non-iterable value counts as one), binding each
  element as `data` unless renamed with `:for-as`.
- `:did-x`/`:will-x` bind lifecycle delegate methods (e.g. `:did-init`,
  `:will-dispose`), called when a scope reaches/leaves that phase.
- Scopes nest lexically, like variables: a named scope is visible from any
  of its descendants with no separate wiring (no `provide`/`inject`, no
  `Context`).
- `<html>`, `<head>`, `<body>` are scopes named `page`, `head`, `body` by
  default.
- `<:import>` splices a fragment in place; `<:define>` declares a custom
  tag; a fragment's root attributes become defaults at its import site.

Compare that to what's required to be productive in most other frameworks
(hooks and dependency arrays, `computed` vs `watch`, whole directive sets,
dependency injection, change detection, ...): the goal is for this list to
stay short.

No rule above has a "convenient" exception (e.g. `class`/`style` silently
merging instead of overriding when re-assigned, or a callback attribute
accepting a bare expression sometimes and requiring a function other
times). A shortcut that only saves a few characters at the call site but
requires every future reader to remember a special case isn't a
simplification, it's deferred, compounding complexity: better to always
type a couple more characters than to hide behavior that depends on
context.

## Integrated reactivity example

```html
<html :count=${0} :light=${true}>
  <head>
    <style>
      body {
        color: ${light ? 'black' : 'white'};
        background-color: ${light ? 'white' : 'black'};
      }
    </style>
  </head>
  <body>
    <button :on-click=${() => count++}>
      Clicked ${count} time${count !== 1 ? 's' : ''}
    </button>
  </body>
</html>
```

## Source level modularity

```html
<!-- lib.htm -->
<lib :light=${true}>

  <style>
    body {
      color: ${light ? 'black' : 'white'};
      background-color: ${light ? 'white' : 'black'};
    }

    .theme-switcher {
      font-size: bold;
    }
  </style>

  <:define tag="theme-switcher:button"
           :class-theme-switcher
           :on-click=${() => head.light = !head.light}>
      Switch theme
  </:define>
</lib>
```

```html
<html>
  <head>
    <:import src="lib.htm" />
  </head>
  <body>
    <theme-switcher />
  </body>
</html>
```

NOTE: root level attributes in imported fragments (`*.htm` files) are applied to `<:import>`'s container tag unless they are already defined there: this allows defaults and override.

NOTE: `<html>`, `<head>`, and `<body>` always have their own scopes and by default they are named `page`, `head`, and `body` respectively: that's why, compined with NOTE above, `head.light = !head.light` works

NOTE: `:class-` prefixes "class attributes", which dynamically add/remove a CSS class name depending on their value (if a value is unspecified as in this example, it's taken as `true`)

NOTE: `<:import>` is only allowed in page `<head>` (or recursively in imported fragments), so imported fragments can rely on their root attributes being available as `head` scope values

## Replication

```html
<html>
  <body>
    <ul :for-each=${[[1, 2, 3], [4, 5]]}>
      <li :for-each=${data}>
        Item ${data}
      </li>
    </ul>
  </body>
</html>
```

NOTE: `:for-` prefixes replication expressions

NOTE: by default the bound value is named `data` (`:for-as` can change that)

NOTE: `:for-each` treats `null`/`undefined` as zero elements (nothing is
rendered); any other non-iterable value is treated as an array of one, so
`:for-each=${maybeItem}` doubles as optional single-item rendering, e.g.
`:for-each=${isLoggedIn ? user : undefined}`

## Data-binding

```html
<html>
  <body>
    <script
      :aka="timer"
      :count=${0}
      :did-init=${() => {
        _timer = setInterval(() => {
          count++;
        }, 100);
      }}
      :will-dispose=${() => {
        _timer && clearInterval(_timer);
        _timer = null;
      }}
      :_timer=${null}
    />
    <div>Ticks ${timer.count}</div>
  </body>
</html>
```
