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

Markout is the presentation layer, and only that. The DOM is the view, your
application's data is the model, and markout is the logic between them:
deriving what is shown from what is true, and folding what a user does back
into data. In the vocabulary of model-view-presenter it is the presenter —
written declaratively rather than as imperative view-pushing. Today the model
is whatever values a page declares; [datasources](docs/concepts/state.md) are
designed to be its home and are not built yet.

## Design philosophy

The objective is to remove as much needless complexity as possible from
reactive web development. The whole language is a handful of rules:

- HTML is the syntax. Anything without a `${...}` or a `:` is plain markup
  and stays plain markup.
- `${...}` is the only expression syntax — plain JavaScript, in text,
  attributes and CSS, with no separate expression language to learn.
  Anything holding one is reactive, so `href=${data.link}` needs no
  further marking.
- `:` names what HTML has no name for, always in the same `:family-name`
  shape: `:class-`, `:style-`, `:attr-`, `:prop-`, `:on-`, `:did-`/`:will-`,
  `:for-`, `:slot` — plus `:name=${...}` to declare a value and `:aka` to
  name a scope.
- Scopes nest lexically, like variables: a value is visible to every
  descendant with no separate wiring — no `provide`/`inject`, no `Context`.
- An expression resolves where it was *written*. A custom tag's body sees
  the scope it was defined in; what you pass at a usage site sees yours.
  That is what lets a component be moved without its meaning changing.
- Two intents get two spellings rather than one guessing from the shape of
  a value: `title=${v}` sets an attribute's value, `:attr-title=${v}` sets
  whether it is there at all.

The full syntax is a single page: **[syntax
reference](docs/reference/syntax.md)**. The reasoning behind each part is in
**[docs/](docs/)**.

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
  <bs-navbar :options=${[
    { name: 'Services', link: '#services' },
    { name: 'Our work', link: '#work' },
    { name: 'Insights', link: '#insights' },
    { name: 'Start a project', link: '#contact', button: true, primary: true},
  ]}>
    Northstar Studio
  </bs-navbar>
```

The markup that was only ever mechanical becomes data. The pinned Bootstrap
version, the integrity hashes, the toggler/collapse `id` wiring and the
accessibility attributes are written once in
[`demo/bootstrap-kit/`](demo/bootstrap-kit/) and can't drift from page to
page.

NOTE: the kit itself is plain HTML too — see
[`parts/navbar.htm`](demo/bootstrap-kit/parts/navbar.htm), where the `<li>` is
the original Bootstrap one with `:for-each=${options}` and a few
`:class-x=${...}` attributes added; there's no component API to learn
beyond the rules above

NOTE: the toggler/collapse wiring is built from `$id`, so each `<bs-navbar>`
gets ids of its own — the reason a component carrying internal `id`/`aria-*`
references can be used more than once on a page at all

NOTE: fragments compose — `all.htm` imports `parts/base.htm` and
`parts/navbar.htm`, so a page can pull in the whole kit or just the parts it
needs

NOTE: since a custom tag is just a tag, the rest of the page stays plain
HTML: you lift out what is boilerplate and leave your content alone, rather
than rewriting the page into a template language

## Two decisions, not one

Choosing a framework today usually settles a second question at the same
time: which UI components you get to use. Ant Design and MUI mean React,
Vuetify means Vue, PrimeNG means Angular. Teams routinely adopt a framework
they have no particular opinion about because the component library they
need exists only there — and from then on neither decision can be revisited
without the other.

Those are separable concerns. A CSS framework is a markup convention; a web
component library is a set of custom elements. Neither needs a framework at
all. What they need is a way to pass values in, set properties that aren't
strings, and listen to events — which is what `:attr-x`, `:prop-x` and
`:on-x` are. (It's also why React needed wrapper packages to consume custom
elements for most of its life.)

So Markout wrapped around Bootstrap, Tailwind or Shoelace keeps both choices
open: change how the page is put together without touching the components,
or change the components without touching the logic.

NOTE: the honest cost — the framework-neutral component ecosystem is
smaller and shallower than React's. Decoupling buys freedom at the price of
reach, and that trade is only worth it if the components you need exist

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

## Optional rendering — designed, not yet implemented

```html
<html :user=${undefined}>
  <body>
    <p :for-data=${user}>Welcome, ${data.name}</p>
  </body>
</html>
```

`:for-data=${expr}` is intended to render its tag once if `expr` is neither
`null` nor `undefined`, and not at all otherwise — the same `data`/`:for-as`
binding as `:for-each`, but for an optional single item rather than a list,
e.g. `:for-data=${isLoggedIn ? user : undefined}`.

It is designed but **not implemented**: writing it today is a compile error.
It appears here because it explains why `:for-each` doesn't quietly accept a
non-iterable and render it once — two intents, two attributes, rather than
one inferring which you meant from the shape of the value.

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

> **`:did-init` and `:will-dispose` are designed but not implemented.** This
> example compiles and renders `Ticks 0`, and then never ticks: the two
> callbacks are parsed, validated and compiled into the page, and nothing
> calls them. It is here for the shape — a value's whole life expressed on
> the element that owns it, with `:_timer` private to that scope — which is
> what the pair are for once the runtime side exists. `:on-` handlers are
> the working way to run code today.
>
> Note it fails differently from
> [`:for-data`](#optional-rendering--designed-not-yet-implemented) above,
> which is refused outright. These are accepted and silent.
