# Bootstrap Kit

Bootstrap 5.3 as Markout components — one part per component, following
[Bootstrap's own cheatsheet](https://getbootstrap.com/docs/5.3/examples/cheatsheet/).

```html
<head>
  <:import src="/bootstrap-kit/all.htm" />
</head>
```

`all.htm` pulls in everything. Each part imports `base.htm` itself and a file
is only imported once per page, so importing parts by hand never leaves
Bootstrap out:

```html
<:import src="/bootstrap-kit/parts/button.htm" />
<:import src="/bootstrap-kit/parts/card.htm" />
```

Run the showcase — every component below, live — with:

```sh
npm run dev:bootstrap-kit
```

That serves two pages: `/index.html`, the showcase, which is every component
one after another; and `/demo.html`, an operations dashboard built out of
them, which is what they look like wired to one page's data.

The dev server is `kits/bootstrap/server.ts` rather than the CLI, because
Orbit is a whole application: it has an API of its own, served from a fake
in-memory database (`orbit-db.ts`), and markout is the middleware that
renders its pages. Orbit reads that API with `std-data` from the std kit,
which fetches while the page renders — so the served console is complete and
the browser asks for nothing.

## Tests

`test/kits/bootstrap-kit.test.ts`, in two tiers:

- **compiled**, which is most of it: every part compiles on its own, the
  showcase compiles and server-renders with nothing reported, and the id
  wiring is checked mechanically — every `aria-controls`, `aria-labelledby`,
  `for`, `data-bs-target` and `data-bs-parent` has to name an element that
  exists. That last one is the kit's whole reason for existing, so it is
  worth a test that can't be argued with.
- **live**, in Playwright: the value-driven components actually driven, and
  a stubbed Bootstrap asserting the plugin calls. Skipped when no browser is
  installed (`npx playwright install chromium`).

Nothing reaches the network: the tests set the URL tokens to local files.

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

**`:extra` adds classes.** A `class` written at a usage site *replaces* the
one a definition sets, which is the language's rule and not something this
kit overrides. So every component takes `:extra` for the utility classes a
caller wants on top:

```html
<bs-alert :variant="warning" :extra="mb-0">Careful</bs-alert>
```

**Lists are arrays.** `:items`, `:options`, `:columns`, `:rows`, `:slides`.
The default value of each is the shape it expects — read the definition to
see it.

**Callbacks are values, not events.** `:select`, `:check` and `:link` are
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
`bs-range`, `bs-modal`, `bs-offcanvas` and `bs-toast` keep `:value` or
`:open` in step with what is on screen. Name the instance and read it from
anywhere:

```html
<bs-input :aka="email" :label="Email" :type="email" />
<bs-button :disabled=${!email.value}>Send</bs-button>
```

That holds however deeply the component sits: a `bs-toast :aka="saved"`
written inside a `bs-toast-container` is still named where you wrote it, so
`saved.open = true` reaches it from anywhere on the page.

**Optional regions are `:for-data`.** A region that exists only when a value
does is written `:for-data=${header}`, and its body may read that value as
`data`. Nothing in there evaluates while the value is absent, which is what
makes `${data.name}` safe to write.

Boolean flags still can't use it — `:for-data` shows for anything that isn't
`null`, so `false` would render — so a dozen regions in the kit are still
written `:for-each=${dismissible ? [1] : []}`. Those are waiting on an `:if`
rather than working around `:for-data`.

Optional parts of a component are parameters, and a named slot where markup
belongs — `bs-card`'s header is both: `:header` sets the text, and a
`:slot="header"` replaces it with markup. A `<:slot>` may sit inside a
`:for-data` but not inside a `:for-each`, which is what makes that possible.

## Where Bootstrap comes from

The CDN URLs and their hashes are tokens like any other, so a page points the
kit at its own copy without forking `base.htm`:

```html
<head :k_bsCssUrl="/vendor/bootstrap.min.css"
      :k_bsJsUrl="/vendor/bootstrap.bundle.min.js"
      :k_bsCssIntegrity=${null}
      :k_bsJsIntegrity=${null}>
  <:import src="/bootstrap-kit/all.htm" />
</head>
```

| Token | Default |
| --- | --- |
| `k_bsCssUrl` | jsDelivr, Bootstrap 5.3.8 |
| `k_bsJsUrl` | jsDelivr, Bootstrap 5.3.8 |
| `k_bsCssIntegrity` | the matching SRI hash |
| `k_bsJsIntegrity` | the matching SRI hash |

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
  Sass with its own variables. Pointing `k_bsCssUrl` at that build is how
  the kit gets out of the way of it.

## Theming

`base.htm` declares the kit's tokens and writes them into Bootstrap's own CSS
variables, so restyling everything is setting one value at the import site:

```html
<head :k_bsRadius="1rem" :k_bsLinkDecoration="none">
  <:import src="/bootstrap-kit/all.htm" />
</head>
```

| Token | Default |
| --- | --- |
| `k_bsRadius` | `0.375rem` |
| `k_bsRadiusSm` | `0.25rem` |
| `k_bsRadiusLg` | `0.5rem` |
| `k_bsRadiusPill` | `50rem` |
| `k_bsFontSans` | Bootstrap's system stack |
| `k_bsLinkDecoration` | `underline` |

Colour modes are `theme.htm`: an inline pre-paint script so the page never
flashes the wrong mode, and `<bs-theme-toggle />` to switch it.

## Components

Every tag also takes `:extra`. Defaults are in the definitions, which are
commented.

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
| `bs-card` | `title` `subtitle` `header` `footer` `image` `imageAlt` `imageBottom` `variant` `border` `align` |
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
- **`bs-pagination` says `:current`, not `:page`.** `page` is already the
  name of `<html>`'s own scope, so a parameter of that name would resolve to
  the scope rather than to the number.
- **`bs-tooltip` and `bs-popover` construct their plugin from a
  `:handle-`.** They are the only two components Bootstrap doesn't start by
  itself, and the usual answer — a page-level loop over
  `[data-bs-toggle="tooltip"]` — misses anything added later. A handler
  builds one per instance instead, and rebuilds it when the text changes.
