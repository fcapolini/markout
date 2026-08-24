# Bootstrap Kit

Bootstrap 5.3 as Markout components — one part per component, following
[Bootstrap's own cheatsheet](https://getbootstrap.com/docs/5.3/examples/cheatsheet/).

```sh
npm install @markout-lang/bootstrap-kit      # in a project
npm install -g @markout-lang/bootstrap-kit   # for a bare docroot
```

See [where kits are found](../../docs/reference/cli.md#where-kits-are-found):
a project's own kits are used whole, and a globally installed one is visible
only to a docroot that has none of its own.

```html
<head>
  <:import src="/npm/@markout-lang/bootstrap-kit/all.htm" />
</head>
```

`/npm/` names the package the fragment came from, and is resolved at compile
time; everything the kit publishes is then addressed at `/bootstrap-kit`, the
logical root it declares. See [npm kits](../../docs/design/npm-kits.md) —
including the other case, a kit vendored into a docroot, which is imported by
its path instead.

`all.htm` pulls in everything. Each part imports `base.htm` itself and a file
is only imported once per page, so importing parts by hand never leaves
Bootstrap out:

```html
<:import src="/npm/@markout-lang/bootstrap-kit/parts/button.htm" />
<:import src="/npm/@markout-lang/bootstrap-kit/parts/card.htm" />
```

Every component below is shown one after another in the [kitchen
sink](https://markout.dev/demos/kitchen-sink), and
[Orbit](https://markout.dev/demos/orbit) is an operations dashboard built out
of them — what they look like wired to one page's data.

## What is and isn't a component

A component earns its place by removing something a person would otherwise
have to keep right by hand:

- **id wiring.** A modal, an accordion, a carousel, a navbar toggler, a
  dropdown menu and a tab panel all connect two elements by `id`. Here the id
  comes from `$id`, which is unique per instance, so a component can appear
  twice on a page.
- **accessibility.** `role`, `aria-label`, `aria-current`, `aria-expanded`,
  `visually-hidden` text: written once, not per use.
- **repetition.** A nav, a breadcrumb, a table, a dropdown menu, a carousel
  and a list group are one shape repeated over a list, so their API is that
  list.

Typography, spacing, the grid and the colour utilities are **not** components.
They are already one class each, and a tag that only forwards a class is a
name to learn for nothing.

## Conventions

Every component follows the same rules, so knowing one is close to knowing
all of them.

**Parameters for the chrome, the slot for the content.** What a card *has* —
a title, a footer, an image — is a parameter. What it *contains* is slotted.

**`class+=` adds classes.** A `class` written at a usage site *replaces* the
one a definition sets, which is the language's rule and not something this
kit overrides — and since every component here computes its own, writing one
gets you a warning naming `class+=`. That is the spelling to reach for:

```html
<bs-alert ::variant="warning" class+="mb-0">Careful</bs-alert>
<bs-alert ::dismissible class-="fade">No animation, please</bs-alert>
```

Every component used to declare an `::extra` parameter for this, hand-rolled
into its own class list — 28 files agreeing on a convention the language now
has a spelling for. `::bodyExtra` on `bs-card` stays, and says why the rest
went: `class+=` reaches a component's own element, and the card's *body* is a
different element.

**Comments in a tag: `//` for one line, `/* … */` for more.** Both are
stripped at parse time. A run of `//` lines reads as a stack of fragments;
one block says it once.

**Lists are arrays.** `::items`, `::options`, `::columns`, `::rows`, `::slides`.
The default value of each is the shape it expects — read the definition to
see it.

**Callbacks are values, not events.** `::select`, `::check` and `::link` are
functions the component calls. `:on-click` and friends stay what they are in
the language: DOM events.

**A plugin is built on attach and released on detach.** The five components
that hand their element to Bootstrap's JS — `bs-modal`, `bs-offcanvas`,
`bs-toast`, `bs-tooltip`, `bs-popover` — do it from `:did-attach` and undo it
from `:will-detach`, not from `:did-init`/`:will-dispose`. A `:for-data`
region takes its markup out of the page without its scope going anywhere,
and a plugin left holding a removed element leaves its backdrop, its popper
and the page's scroll lock behind.

**Values are read and written.** `bs-input`, `bs-select`, `bs-check`,
`bs-range`, `bs-modal`, `bs-offcanvas` and `bs-toast` keep `::value` or
`::open` in step with what is on screen. Name the instance and read it from
anywhere:

```html
<bs-input :aka="email" ::label="Email" ::type="email" />
<bs-button ::disabled=${!email.value}>Send</bs-button>
```

That holds however deeply the component sits: a `bs-toast :aka="saved"`
written inside a `bs-toast-container` is still named where you wrote it, so
`saved.open = true` reaches it from anywhere on the page.

`bs-input` and `bs-textarea` answer `valid` the same way -- is there a value,
and does it pass `check`? -- which is what a submit button needs:

```html
<bs-input :aka="email" ::label="Email" ::check=${v => v.includes('@')} />
<bs-button ::disabled=${!email.valid}>Send</bs-button>
```

It is not the negation of the error state. An empty field is not marked
wrong, which is what keeps a form from opening in red, and it is not
something to submit either -- so it shows nothing and answers `false`.
`required` is what makes empty an error as well as a gap.

**Optional regions are `:if`.** A region that exists only when a parameter
was given is written `:if=${header}`, and nothing inside it evaluates while
the condition is false — which is what makes `${user.name}` safe to write in
one. It asks the question JavaScript asks, so an unset parameter and an
empty string both count as absent:

```html
<bs-close :if=${dismissible} />
<span :if=${!split}>${label}</span>
```

`:else-if` and `:else` continue it, on the element immediately after. The
kit uses them where a component chooses between renderings rather than
merely omitting one — `bs-nav` between a tab button and a plain link:

```html
<button class="nav-link" :if=${toggle} ...>${item.name}</button>
<a class="nav-link" :else ...>${item.name}</a>
```

and `bs-dropdown` between the three things an item can be:

```html
<hr class="dropdown-divider" :if=${item.divider}>
<h6 class="dropdown-header" :else-if=${item.header}>${item.header}</h6>
<a class="dropdown-item" :else ...>${item.name}</a>
```

`:for-data` is for the other case — there is something to show, and the body
wants it. It is `!= null` rather than truthy, so `0` and `''` stay data, and
it binds the item as `data`. The kit has no use for it: every optional region
here renders a parameter it already has a name for.

Optional parts of a component are parameters, and a named slot where markup
belongs — `bs-card`'s header is both: `::header` sets the text, and a
`:slot="header"` replaces it with markup. A `<:slot>` may sit inside a
`:for-data` but not inside a `:for-each`, which is what makes that possible.

## Where Bootstrap comes from

The CDN URLs and their hashes are tokens like any other, so a page points the
kit at its own copy without forking `base.htm`:

```html
<head :const-bsCssUrl="/vendor/bootstrap.min.css"
      :const-bsJsUrl="/vendor/bootstrap.bundle.min.js"
      :const-bsCssIntegrity=${null}
      :const-bsJsIntegrity=${null}>
  <:import src="/bootstrap-kit/all.htm" />
</head>
```

| Token | Default |
| --- | --- |
| `bsCssUrl` | jsDelivr, Bootstrap 5.3.8 |
| `bsJsUrl` | jsDelivr, Bootstrap 5.3.8 |
| `bsCssIntegrity` | the matching SRI hash |
| `bsJsIntegrity` | the matching SRI hash |

Drop the hashes when self-hosting: `crossorigin` follows the hash, and
neither means anything on a same-origin file.

Four reasons this is worth having rather than a convenience:

- **A content security policy** that allows no third-party origin, which is
  most of them once an app is behind a login.
- **An offline or air-gapped build**, where a CDN isn't reachable at all.
- **A vendored, pinned copy**, so the page doesn't depend on a third party
  staying up or staying honest.
- **Your own Bootstrap build.** The tokens below only reach what Bootstrap
  exposes as CSS variables; a design system usually compiles Bootstrap from
  Sass with its own variables. Pointing `bsCssUrl` at that build is how
  the kit gets out of the way of it.

## Theming

`base.htm` declares the kit's tokens and writes them into Bootstrap's own CSS
variables, so restyling everything is setting one value at the import site:

```html
<head :const-bsRadius="1rem" :const-bsLinkDecoration="none">
  <:import src="/bootstrap-kit/all.htm" />
</head>
```

| Token | Default |
| --- | --- |
| `bsRadius` | `0.375rem` |
| `bsRadiusSm` | `0.25rem` |
| `bsRadiusLg` | `0.5rem` |
| `bsRadiusPill` | `50rem` |
| `bsFontSans` | Bootstrap's system stack |
| `bsLinkDecoration` | `underline` |

Colour modes are `theme.htm`: an inline pre-paint script so the page never
flashes the wrong mode, and `<bs-theme-toggle />` to switch it.

## Components

Every tag takes `class+=` and `class-=`, which are the language's and not
listed here. Defaults are in the definitions, which are commented.

### Content

| Tag | Parameters |
| --- | --- |
| `bs-image` | `src` `alt` `fluid` `thumbnail` `rounded` |
| `bs-figure` | `src` `alt` `caption` `align` |
| `bs-table` | `columns` `rows` `caption` `striped` `hover` `bordered` `borderless` `small` `variant` `headVariant` `align` `responsive` |

### Forms

| Tag | Parameters |
| --- | --- |
| `bs-input` | `label` `type` `name` `value` `placeholder` `help` `size` `disabled` `readonly` `required` `floating` `check` `message` |
| `bs-textarea` | `label` `name` `value` `placeholder` `rows` `help` `disabled` `readonly` `required` `check` `message` |
| `bs-select` | `label` `name` `options` `value` `placeholder` `help` `size` `multiple` `disabled` `required` `floating` |
| `bs-check` | `label` `type` (`checkbox`/`radio`/`switch`) `name` `value` `checked` `inline` `reverse` `disabled` `help` |
| `bs-check-group` | `legend` `type` `options` `value` `inline` `disabled` |
| `bs-range` | `label` `name` `min` `max` `step` `value` `disabled` `showValue` |
| `bs-input-group` | `prefix` `suffix` `size` |

`bs-input` and `bs-textarea` also answer `valid`, which is read rather than
passed -- see *Values are read and written* above.

### Components

| Tag | Parameters |
| --- | --- |
| `bs-accordion` | `exclusive` `flush` |
| `bs-accordion-item` | `title` `open` |
| `bs-alert` | `variant` `heading` `dismissible` |
| `bs-badge` | `variant` `pill` `position` |
| `bs-breadcrumb` | `items` `divider` |
| `bs-button` | `variant` `outline` `size` `active` `disabled` `type` `toggle` `target` `dismiss` |
| `bs-link` | `href` `variant` `outline` `size` `active` `disabled` `button` `toggle` `target` |
| `bs-button-group` | `label` `size` `vertical` |
| `bs-button-toolbar` | `label` `gap` |
| `bs-close` | `label` `dismiss` `disabled` |
| `bs-card` | `title` `subtitle` `header` `footer` `image` `imageAlt` `imageBottom` `variant` `border` `align` `bodyExtra` |
| `bs-card-group` | `cols` `gap` `attached` |
| `bs-carousel` | `slides` `controls` `indicators` `captions` `fade` `ride` `interval` `dark` |
| `bs-collapse` | `name` `open` `horizontal` |
| `bs-dropdown` | `label` `items` `variant` `outline` `size` `split` `direction` `align` `dark` |
| `bs-list-group` | `items` `flush` `horizontal` |
| `bs-modal` | `name` `title` `size` `centered` `scrollable` `fullscreen` `staticBackdrop` `open` |
| `bs-nav` | `items` `variant` `fill` `justified` `vertical` `align` `toggle` |
| `bs-tab-content`, `bs-tab-pane` | `name` `active` |
| `bs-navbar` | `items` `brand` `expand` `container` `sticky` `fixed` `theme` `bg`; slots: default (brand), `end` |
| `bs-offcanvas` | `name` `title` `placement` `backdrop` `scroll` `responsive` `open` |
| `bs-pagination` | `current` `pages` `size` `align` `prev` `next` `link` `select` `label` |
| `bs-placeholder` | `cols` `size` `variant` `animation` |
| `bs-popover` | `title` `content` `placement` `trigger` `html` |
| `bs-progress` | `value` `min` `max` `label` `variant` `striped` `animated` `height` `name` |
| `bs-progress-stacked` | — |
| `bs-scrollspy` | `target` `offset` `smooth` `height` |
| `bs-spinner` | `variant` `type` `small` `label` |
| `bs-theme-toggle` | `variant` `outline` `size` |
| `bs-toast` | `title` `time` `variant` `open` `autohide` `delay` |
| `bs-toast-container` | `placement` |
| `bs-tooltip` | `title` `placement` `html` `trigger` |

## Notes on the awkward corners

A few components are shaped by something in the language rather than by
Bootstrap, and each says so in its own file:

- **`bs-accordion-item` reads `$host`.** An item needs the id of the
  accordion it sits in, and slotted markup resolves at the call site, so it
  cannot reach it by name. `$host` is the instance it was slotted *into* —
  the one place the kit needs the structural relationship rather than the
  lexical one. No id is written by anyone.
- **`bs-pagination` says `::current`, not `::page`.** `page` is already the
  name of `<html>`'s own scope, so a parameter of that name would resolve to
  the scope rather than to the number.
- **`bs-tooltip` and `bs-popover` construct their plugin from a
  `:handle-`.** They are the only two components Bootstrap doesn't start by
  itself, and the usual answer — a page-level loop over
  `[data-bs-toggle="tooltip"]` — misses anything added later. A handler
  builds one per instance instead, and rebuilds it when the text changes.
