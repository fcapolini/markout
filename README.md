# Markout

[
  ![Build](https://github.com/fcapolini/markout/actions/workflows/build.yml/badge.svg?branch=main&event=push)
](https://github.com/fcapolini/markout/actions/workflows/build.yml)
[
  ![Test](https://github.com/fcapolini/markout/actions/workflows/test.yml/badge.svg?branch=main&event=push)
](https://github.com/fcapolini/markout/actions/workflows/test.yml)
[
  ![Coverage](https://github.com/fcapolini/markout/actions/workflows/coverage.yml/badge.svg?branch=main&event=push)
](https://github.com/fcapolini/markout/actions/workflows/coverage.yml)
[
  ![CodeQL](https://github.com/fcapolini/markout/actions/workflows/codeql.yml/badge.svg?branch=main&event=push)
](https://github.com/fcapolini/markout/actions/workflows/codeql.yml)

HTML-first reactive web framework, aiming at presenting developers with the
equivalent of a natively modular and reactive HTML. It is isomorphic: the same
scope/value model runs on the server and in the browser, so SSR comes for
free.

## Design philosophy

The objective is to remove as much needless complexity as possible from
reactive web development. The whole language is meant to stay a handful of
rules:

- `${...}` is the only interpolation syntax, in attributes, text and CSS:
  it's plain JavaScript, no separate expression language to learn. Anything
  holding one is reactive, so `href=${data.link}` needs no further marking —
  the attribute already has a name.
- `:` names what HTML has no name for: scope values, class and style
  toggles, events, lifecycle, replication. Everything else is plain HTML.
- `:name=${expr}` on a tag declares a reactive value in that tag's scope.
- `:on-x` binds an event, `:class-x` toggles a CSS class, `:style-x` writes
  a CSS property — presence implies `true`, always the same way.
- `:attr-x` toggles whether an attribute is *present*, as boolean and
  custom-element attributes need: `open=${false}` writes `open="false"`,
  and an attribute that is there reads as true whatever it says.
- `:prop-x` assigns an element property, for what an attribute can't carry
  (objects, arrays, functions). Browser-only, since a property is state on
  an element rather than part of the document.
- `:for-each=${expr}` repeats a tag once per element (`null`/`undefined`
  means zero), binding each element as `data` unless renamed with
  `:for-as`; `:for-data=${expr}` renders a tag once if `expr` isn't
  `null`/`undefined`, zero times otherwise — two different intents, so two
  different attributes, rather than one guessing which you meant from the
  shape of the value.
- `:did-x`/`:will-x` bind lifecycle delegate methods (e.g. `:did-init`,
  `:will-dispose`), called when a scope reaches/leaves that phase.
- Scopes nest lexically, like variables: a named scope is visible from any
  of its descendants with no separate wiring (no `provide`/`inject`, no
  `Context`).
- `<html>`, `<head>`, `<body>` are scopes named `page`, `head`, `body` by
  default.
- `<:import>` splices a fragment in place; `<:define>` declares a custom
  tag; a fragment's root attributes become defaults at its import site.
- `<:slot>` marks where a custom tag takes the content written at its usage
  site, `<:slot name="x">` when there's more than one; a child picks its
  slot with `:slot="x"`, and a slot's own content is the fallback.
- An expression resolves where it was WRITTEN: a definition's body sees the
  definition's scope, a usage site's attributes and content see the call
  site. That one rule is what lets a component be dropped anywhere without
  its meaning changing.
- `$id` is the current scope's identifier, unique per page — what a
  component builds `id`/`aria-controls`/`for` out of.

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

## CLI

Build the project, then serve a directory containing Markout HTML files:

```sh
npm run build
npx markout ./demo
```

The CLI accepts an optional port with `-p` or `--port` and uses port `3000` by
default:

```sh
npx markout ./demo --port 8080
```

`-d`/`--dev` turns on dev mode, which surfaces runtime expression errors instead
of only logging them server-side. A page whose expressions failed during server
rendering is replaced by one listing the errors (no content, no runtime — it
would only fail the same way in the browser); failures that happen after the
page loads appear in a panel at the bottom of it:

```sh
npx markout ./demo --dev
```

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
    <button :on-click=${() => light = !light}>
      Switch theme
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

NOTE: `<html>`, `<head>`, and `<body>` always have their own scopes and by default they are named `page`, `head`, and `body` respectively: that's why, combined with NOTE above, `head.light = !head.light` works

NOTE: `:class-` prefixes "class attributes", which dynamically add/remove a CSS class name depending on their value (if a value is unspecified as in this example, it's taken as `true`)

NOTE: `<:import>` is only allowed in page `<head>` (or recursively in imported fragments), so imported fragments can rely on their root attributes being available as `head` scope values

## Componentization

Reactivity aside, `<:define>` alone is enough to turn recurring markup into
a tag: no build step, no component base class, no separate file format —
a fragment of HTML, given a name.

[`demo/bootstrap/index.html`](demo/bootstrap/index.html) and
[`demo/bootstrap/index-plain.html`](demo/bootstrap/index-plain.html) render
the same page and are byte-identical from `<main>` down. All the difference
is in the first 35 lines. Plain Bootstrap needs 5 lines of `<head>`
boilerplate (charset, viewport, CDN links with their integrity hashes) and
23 lines of navbar (nested `nav > div > ul > li > a`, a toggler button,
`data-bs-target` matched by hand to the collapse `id`, four ARIA
attributes). With a kit of Markout fragments, the same thing is:

```html
<head>
  <:import src="/bootstrap-kit/all.htm" />
  <title>Northstar Studio | Product Design for Growing Teams</title>
</head>

<body>
  <bs-nav :title="Northstar Studio" :options=${[
    { name: 'Services', link: '#services' },
    { name: 'Our work', link: '#work' },
    { name: 'Insights', link: '#insights' },
    { name: 'Start a project', link: '#contact', button: true, primary: true},
  ]} />
```

The markup that was only ever mechanical becomes data. The pinned Bootstrap
version, the integrity hashes, the toggler/collapse `id` wiring and the
accessibility attributes are written once in
[`demo/bootstrap-kit/`](demo/bootstrap-kit/) and can't drift from page to
page.

NOTE: the kit itself is plain HTML too — see
[`parts/nav.htm`](demo/bootstrap-kit/parts/nav.htm), where the `<li>` is
the original Bootstrap one with `:for-each=${options}` and a few
`:class-x=${...}` attributes added; there's no component API to learn
beyond the rules above

NOTE: the toggler/collapse wiring is built from `$id`, so each `<bs-nav>`
gets ids of its own — the reason a component carrying internal `id`/`aria-*`
references can be used more than once on a page at all

NOTE: fragments compose — `all.htm` imports `parts/base.htm` and
`parts/nav.htm`, so a page can pull in the whole kit or just the parts it
needs

NOTE: since a custom tag is just a tag, the rest of the page stays plain
HTML: you lift out what is boilerplate and leave your content alone, rather
than rewriting the page into a template language

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

NOTE: `:for-` prefixes anything related to replication/optional data, a
shared namespace for `:for-each`/`:for-as`/`:for-key`/`:for-data`

NOTE: by default the bound value is named `data` (`:for-as` can change that)

NOTE: `:for-each` treats `null`/`undefined` as zero elements (nothing is
rendered) and otherwise expects an iterable; it never guesses at a scalar
meaning "one", since that would make its meaning depend on the incidental
shape of the value rather than being one fixed rule

## Optional rendering

```html
<html :user=${undefined}>
  <body>
    <p :for-data=${user}>Welcome, ${data.name}</p>
  </body>
</html>
```

NOTE: `:for-data=${expr}` renders its tag once if `expr` is neither `null`
nor `undefined`, and not at all otherwise — the same `data`/`:for-as`
binding as `:for-each`, but for an optional single item rather than a
list, e.g. `:for-data=${isLoggedIn ? user : undefined}`

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
