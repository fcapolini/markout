# std Kit

The system parts of a page — the things a framework usually builds *into* the
language — written **with** it instead.

It ships with the compiler, so a page has it already:

```html
<body>
  <std-data ::url="/api/rows" :aka="rows" />
</body>
```

No install and no import. `@markout-lang/core` depends on this kit and splices
it into the head of every page it compiles, before anything the page wrote —
so a page that defines `std-data` itself simply wins the name back, and a
page that would rather say it out loud can still write the import, which is
skipped rather than doubled:

```html
<head>
  <:import src="/npm/@markout-lang/std-kit/all.htm" />
</head>
```

Installing it directly is only for pinning a version of your own:

```sh
npm install @markout-lang/std-kit      # in a project
npm install -g @markout-lang/std-kit   # for a bare docroot
```

See [where kits are found](../../docs/reference/cli.md#where-kits-are-found)
for which of the two a given docroot will use.

The [std demo](https://markout.dev/demos/std/) puts it end to end. Read the
**source** of that page rather than the page: the data is in the HTML, not
fetched into it, which is the point.

## Why this kit exists

The bootstrap kit proved the language could express a design system. This one
points the same test at the runtime: I/O, lifetime, the outside world. What
it can't express cleanly is a finding about the language, and the two it
found — server-only values and an async render — are now part of it rather
than part of this kit. `std-data` below has no runtime special case of its
own, which is the whole claim.

That also sets what belongs here. `<math.h>` and `<string.h>` are pure
functions, and this language already has a shape for those — a value holding
a function, `:fmt=${(n) => ...}`. Wrapping those in tags would be a name to
learn for nothing. `<stdio.h>` is the half that genuinely needs a scope, a
lifetime and somewhere to keep state, and that is what a kit part is for.

## `std-data`

Fetch a URL, hand the page what came back.

```html
<std-data :aka="people" ::url="/people.json" />

<table :for-data=${people.data}>
  <tr :for-each=${data.rows}>
    <td>${data.name}</td>
  </tr>
</table>
```

The server fetches while it renders, waits, and sends the result with the
page. So the rows are in the served HTML, the browser fetches nothing, and
there is no flash — `${rows}` in the page is `${rows}` in the markup.

> **A relative `::url` needs something serving the page.** A build has no
> request to take an origin from, so a page compiled ahead of time needs an
> absolute `::url`, a `::client` datasource, or `markout build --origin`.
> Without one of those the build stops and names the datasource.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `::url` | `""` | Where to fetch. Nothing happens without one. Page-relative is fine while something is serving the page — see above. |
| `::client` | `false` | Fetch in the browser instead of while rendering. |

| Reads | Meaning |
| --- | --- |
| `data` | The parsed body, or `null`. |
| `error` | A message, or `null`. A 404 lands here, not in a log. |
| `loading` | True while a *browser* fetch is in flight. |
| `reload()` | Refetch in the browser. |

It renders nothing. It still has to *be* somewhere, and where it is written
is where its name resolves, so put it at the top of the region that reads it.

### The URL means the same thing in both modes

`::url="/people.json"` works served or `::client`, because the component
resolves it against `$origin` — which the server takes from the request and
the browser from `location`. Without that the two would disagree: a server
has no page to be relative *to*, so a bare path there is not a different
address, it is not an address at all.

Which is also why `markout prerender` is the delivery to watch. It has no
request behind the render, so there is no `$origin`, and a relative `::url` has
nothing to resolve against at the moment it would be fetched:

```
cannot fetch "/people.json" while rendering: it is relative and nothing is
serving this page, so there is no address to resolve it against.
```

The prerender stops there rather than writing a page with a hole in it. Give
the datasource an absolute `::url`, mark it `::client` so the browser resolves it
against a real `location.origin`, or say what the pages are being rendered for
— `markout prerender --origin http://127.0.0.1:3000`, with the docroot served
from another terminal, which is how a page whose data is files in its own
docroot gets prerendered at all.

`markout build` never meets this, because it evaluates nothing: the datasource
is compiled and the browser fetches it on arrival, where `location.origin` is
always there. That is the trade — no content in the markup, and nothing needed
at build time.

A URL that *changes* refetches, in the browser, since that is where the
change happened:

```html
<std-data :aka="people" ::url=${`/people/${page}.json`} />
```

The first evaluation is the one that differs between the modes. A served
datasource already has its answer and does not fetch again on arrival — that
second request is the thing this design exists to avoid. A `::client` one has
nothing yet, so it does.

### `::client`, and what not to publish

A served result is written into the page as plain text. Anything the page
should not hand to whoever views the source — a session, a credential,
another user's row — belongs behind `::client`, which leaves the render alone
and fetches on arrival:

```html
<std-data :aka="mine" ::client ::url="/api/me" />
<p>${mine.loading ? 'Loading…' : mine.data?.name}</p>
```

That is the trade the two modes are: `::client` costs a request and a flash
and publishes nothing; the default costs neither and publishes everything it
fetched.

### Errors are values

A 404 or a refused connection is a fact about the page's data, not a fault in
the render, so it comes back as `error` rather than going to a server log the
visitor cannot see:

```html
<p :for-data=${people.error}>Could not load: ${data}</p>
```

What *is* reported is a fetch that never returns: the render gives up at its
deadline, the value is `undefined`, and the page is still served.

### `reload()`

A served page already has its data, so nothing refetches on arrival — the
second request most frameworks make on hydration is the one this kit is built
to avoid. When a page does want fresh data, it asks:

```html
<button :on-click=${() => people.reload()} :attr-disabled=${people.loading}>
  ${people.loading ? 'Reloading…' : 'Refresh'}
</button>
```

A browser fetch wins over the served one from then on, being the newer of the
two.

## Notes on `std-data`'s awkward corners

- **`:handle-`, not `:did-init`.** The browser fetch hangs off a `:handle-`
  on the resolved URL rather than an init callback, so a `::url` that changes
  refetches instead of being read once. A `_started` flag is what makes the
  *first* call behave differently in the two modes.
- **`_served` is the only value that crosses.** Everything else here is
  derived from it and re-derives in the browser as usual — keep the source,
  never the derivation.
- **The `<script type="application/json">` idea is gone.** An earlier design
  had the component carrying its own payload in its root element. It doesn't
  need to: the result travels in the page's state, so the root is a plain
  hidden `<span>` and the component has no markup contract at all.

## `std-router`

Routing for a page that is one screen with several states. `<std-router>`
holds a `<std-route>` per screen, and the query string says which one shows:

```html
<std-router>
  <nav>
    <a href="?index" :class-active=${home.selected}>Home</a>
    <a href="?about" :class-active=${about.selected}>About</a>
  </nav>

  <std-route :aka="home" ::page="index">
    <h1>Home</h1>
  </std-route>

  <std-route :aka="about" ::page="about">
    <h1>About</h1>
  </std-route>
</std-router>
```

### The query, not the fragment

A browser never sends `#about` to the server, so a fragment-routed page can
only ever respond with its default route and correct itself on arrival —
which a person with JavaScript hardly notices and a link unfurler, an RSS
reader, `curl` or a crawler never gets past. `?about` *is* sent, so the
server renders the asked-for route into the response.

It costs nothing to get that. `?about` and `?index` are the same file, so a
host serving static files already serves every route: no rewrite rule, no
catch-all, nothing to configure.

### One markup, both modes

Where the Navigation API exists the router cancels the document load and the
screen switches in place. Where it does not, the click is an ordinary link
and the browser fetches the same file with a different query, landing on the
same route. There is no second branch in the component — the multi-page mode
is what happens when nothing intercepts. Back and forward stay the browser's
throughout, and a reload is left alone rather than intercepted.

**Only navigations that stay in this document.** `canIntercept` is true for
any same-origin navigation, another page included, and cancelling one of those
strands the reader: the address moves, no route here answers to it, and
nothing loads until a manual reload. A link to a different pathname is a
round trip by design, and the router leaves it to the browser — which is the
division the whole part rests on. The pathname decides where a round trip is
unavoidable; the query decides everything inside one.

`$url` is what the router reads, and the runtime is what keeps `$url` on the
document's address. So the router holds no copy of it, and every other
expression on the page sees the same address it does.

### Parameters

`std-router`:

| | default | |
| --- | --- | --- |
| `::defaultPage` | `"index"` | the page to show when the address names none — a bare `/`, or a page built with no address at all |
| `::fallback` | `::defaultPage` | the page to show when the address names one that does not exist |
| `::page` | derived | the route now showing. Read it; it follows the address |

They are two parameters because they answer different questions, and folding
them together would put a visible 404 at the front door. A site with no 404
screen names neither and gets `index`, or names `::defaultPage` alone and gets
that — `::fallback` follows it until you give it one of its own.

`std-route`:

| | default | |
| --- | --- | --- |
| `::page` | `"index"` | the name this route answers to |
| `::selected` | derived | whether it is the one showing — what a nav link reads |

The router finds its routes itself: the names are written once, on the
routes, and an address naming none of them resolves while *rendering*, so
the served markup already shows the right page.

### What it does not do

Routers nest. A `<std-router>` written inside a route owns the next segment
of the path — `?about/team` is `about` outside and `team` within — and each
level asks the nearest router above it which segment is its own, so no level
is told its own ancestry. A level the address says nothing about falls to its
own `::defaultPage`, so `?about` shows that section's index.

Links are written whole, from the root: `<a href="?about/team">`. There is no
relative form, so a nested link spells its ancestors out.

What is still missing is matching that is not by exact name: no parameters
(`?user/42` selects a route called `42`, not a `:id`), no patterns, no
ranking.

A route must be written inside its `<std-router>` with only plain markup in
between — plain markup and other components are fine, another `<std-router>`
starts a new level. Wrapped in another component it fails loudly, because `$host` is then
that component and has no `add` to call.

For the path, nesting and parameters, see
[advanced-router-kit.md](../../docs/design/advanced-router-kit.md) — a
separate design, and an alternative to this rather than a later stage of it.
