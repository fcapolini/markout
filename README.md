<img src="assets/logo.svg" alt="" width="70" align="left">

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

## Two ways to deliver a page

A compiled page is one artifact, and it runs in two places, so there are two
ways to put it in front of a visitor. Which one you pick decides how much of the
page arrives already rendered — not how it is written.

**Served by Node**, with the CLI below or the Express middleware. The render
runs per request, so the page can read what a request has: `:server-` values
run on the server, and a datasource fetches before the page is serialized. The
visitor gets finished HTML that then comes alive. This is the isomorphic mode,
and it is the one that makes SSR come for free.

**Compiled ahead of time** into static assets, for everyone else — a project
served by Rails, Django, Laravel, PHP, or a bucket behind a CDN. Markout
becomes a build step rather than something in your request path: the backend
stays exactly as it is, and what it serves is plain HTML and JavaScript.

The second mode is not "client-side rendering" in the usual sense. The same
render pass runs at build time, so the markup is in the file — a page's static
content does not flash in after JavaScript loads. What it cannot carry is only
what a request would have supplied: a `:server-` value has no result, and a
datasource has to be marked `:client` so the browser fetches it on arrival.
[Rendering](docs/concepts/rendering.md#two-ways-to-deliver-a-page) has the
details.

`markout build` below is what produces the second kind. It is what lets the
server-rendered majority of projects adopt Markout without moving off the stack
they already run.

## CLI

Serve a directory of Markout HTML files:

```sh
npx markout ./site
```

### The `markout/` convention

Name that directory `markout/` and there is nothing to type and nothing to
configure:

```
markout/          your pages
  index.html
  lib.htm
```

```sh
npx markout          # serves ./markout
npx markout build    # compiles ./markout into ./dist
```

This is a convention, not a rule — any directory works when you name it. It
earns its place by being the one thing a project can say without installing
anything: there is no `package.json` in the layout above, and nothing had to
be configured for either command to know what to do.

It is also what the editor support reads. [The VS Code
extension](docs/design/editor-support.md) has to resolve `/lib.htm` the same
way the server will, and in a project with no `package.json` the folder name
is the only thing that says where the docroot is. `markout/` rather than
`public/`, `www/` or `static/` for exactly that reason: those belong to every
static-site tool there is, and claiming one would mean guessing at somebody
else's layout.

The CLI accepts an optional port with `-p` or `--port` and uses port `3000` by
default:

```sh
npx markout ./demo --port 8080
```

`-d`/`--dev` turns on dev mode, which does two things. It surfaces runtime
expression errors instead of only logging them server-side: a page whose
expressions failed during server rendering is replaced by one listing the
errors (no content, no runtime — it would only fail the same way in the
browser), while failures that happen after the page loads appear in a panel at
the bottom of it. And it reloads open pages when anything under the docroot
changes, error pages included, so fixing the file is enough to see the fix:

```sh
npx markout ./demo --dev
```

`-c`/`--compress` gzips rendered pages and static files for clients whose
`Accept-Encoding` allows it. It's off by default: compressing costs CPU per
request, and behind a reverse proxy that already does it the work would be
done twice.

```sh
npx markout ./demo --compress
```

### Building static files

`markout build` compiles a docroot ahead of time into a directory you can put on
any host. The source is the first argument and the output the second:

```sh
npx markout build ./site ./dist
```

Both are optional. The docroot defaults to `./markout` and the output to a
`dist/` *beside* it — beside rather than inside, because a build refuses an
output directory under the docroot: the next run would compile its own output.
So the whole ahead-of-time mode is:

```sh
npx markout build
```

It compiles every `.html` under the docroot, writes the browser runtime beside
them, and copies everything else across — except `.htm` fragments, which are
source that reaches the output inlined into the pages that imported them, and
dot-prefixed files, which the server refuses to serve either.

Three dot-prefixed names are copied, because a deployable needs them:
`.well-known/` (RFC 8615 — ACME challenges, `security.txt`), `.nojekyll` and
`.htaccess`. Everything else beginning with a dot stays behind, which is the
way round that matters: what a host needs to serve is a short standardised
list, while what must never be published — `.env`, `.git/`, `.DS_Store` —
grows with every tool you install.

`/.well-known/` is also served when running from Node, rather than 404'd with
the other dot-paths, so a certificate can be issued for a docroot markout is
serving. `.nojekyll` and `.htaccess` are not: a host reads those, a browser
never asks for them.

A compile error prints as `file:line:column: message` and **exits non-zero**, so
CI can gate on it. The pages that did compile are still written; only the ones
that failed are missing.

An expression that throws while *rendering* is treated one of two ways,
depending on whether anything can still repair it. An ordinary value is
re-derived in the browser, where it may well succeed — `${user.name}` asked
before its datasource has answered is the everyday case, and the served page is
fine — so that is a warning and the page is written. A `:server-` value is not:
it crosses frozen, with a result and no expression, so nothing re-runs it. That
**fails the build**, and the page is not written, on the same grounds as one
that would not compile.

That is the failure this mode invites, since a built page has no request behind
it and so no `$origin`. A datasource with a relative `:url` therefore fails the
build and says to mark it `:client` — after which the browser fetches it on
arrival. An *absolute* `:url` still fetches while building and bakes the answer
into the page, which is static site generation and worth having.

`--origin` is the third way out, and the one for a docroot whose data sits in
it as files:

```sh
npx markout ./site                                   # in one terminal
npx markout build ./site ./dist -o http://127.0.0.1:3000
```

It says what `$origin` is while the pages are built, so a relative `:url`
resolves exactly as it does when served. Any server for the same directory will
do — the one above, or the host the pages are being deployed to. This is what
lets a page fetch its own data and still be a static deployment: the fetching
happens once, here, and what ships is the answer.

`-p`/`--page` restricts the build to one page, and can be given more than once.
A leading slash and the `.html` extension are both optional:

```sh
npx markout build ./demo ./dist -p index -p /about.html
```

A restricted build still writes the runtime — a page without it is not a page —
but does not copy assets, since re-copying the whole tree is the part nobody
wanted repeated.

Three things it refuses, each because the alternative is a silent failure
someone finds later: an output directory inside the docroot (the next build
would compile its own output), a docroot inside the output directory (it would
write over its own sources), and a docroot file named like the runtime — that
one used to be copied over the runtime after it was written, leaving every page
in the output broken and the build reporting success.

Every page, served or built, loads the runtime from `/markout-runtime.js`. It is
deliberately not dot-prefixed: a served page has that path *answered* by the
middleware, so it is never a file, but a built page makes it a real file on
somebody else's host — and a dot is what hosts use to decide a file is not for
publishing. GitHub Pages runs Jekyll, which drops dotfiles unless a `.nojekyll`
sits beside them, and denying dot-paths is common server hardening. The cost of
the plain name is that a docroot file at that path is shadowed when serving,
which `markout()` warns about at startup.

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

[`demos/bootstrap/index.html`](sites/site/demos/bootstrap/index.html) and
[`demos/bootstrap/index-plain.html`](sites/site/demos/bootstrap/index-plain.html) render
the same page, and almost all of the difference between them is in the first
35 lines. Plain Bootstrap needs 5 lines of `<head>` boilerplate (charset,
viewport, CDN links with their integrity hashes) and 22 lines of navbar
(nested `nav > div > ul > li > a`, a toggler button, `data-bs-target` matched
by hand to the collapse `id`, four ARIA attributes). With a kit of Markout
fragments, the same thing is:

```html
<head>
  <:import src="/npm/@markout-dev/bootstrap-kit/all.htm" />
  <title>Northstar Studio | Product Design for Growing Teams</title>
</head>

<body>
  <bs-navbar :items=${[
    { name: 'Services', link: '#services' },
    { name: 'Our work', link: '#work' },
    { name: 'Insights', link: '#insights' },
    { name: 'Start a project', link: '#contact', button: true },
  ]}>
    Northstar Studio
  </bs-navbar>
```

The markup that was only ever mechanical becomes data. The pinned Bootstrap
version, the integrity hashes, the toggler/collapse `id` wiring and the
accessibility attributes are written once in
[`@markout-dev/bootstrap-kit`](kits/bootstrap-kit/) and can't drift from page to
page. The kit is an installed package here, which is what `/npm/` in the
import says — see [npm kits](docs/design/npm-kits.md); a kit vendored into
the docroot is imported by its path instead.

NOTE: the kit itself is plain HTML too — see
[`parts/navbar.htm`](kits/bootstrap-kit/parts/navbar.htm), where the `<li>` is
the original Bootstrap one with `:for-each=${items}` and a few
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

## Optional rendering

```html
<html :user=${undefined}>
  <body>
    <p :for-data=${user}>Welcome, ${data.name}</p>
  </body>
</html>
```

`:for-data=${expr}` renders its tag once if `expr` is neither `null` nor
`undefined`, and not at all otherwise — the same `data`/`:for-as` binding as
`:for-each`, but for an optional single item rather than a list.

That is also why `:for-each` doesn't quietly accept a non-iterable and render
it once: two intents, two attributes, rather than one inferring which you
meant from the shape of the value.

The body doesn't evaluate while there is nothing to show, which is the point
rather than an optimisation — `${data.name}` above has to be safe to write.
And the element itself is moved rather than rebuilt, so whatever the DOM was
holding survives a round trip.

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
> the working way to run code today. They are the last unimplemented pair in
> the reference, and they fail the quiet way: accepted, compiled, and never
> called.
