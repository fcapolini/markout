# std Kit

The system parts of a page — the things a framework usually builds *into* the
language — written **with** it instead.

It ships with the compiler, so a page has it already:

```html
<body>
  <std-data :url="/api/rows" :aka="rows" />
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
<std-data :aka="people" :url="/people.json" />

<table :for-data=${people.data}>
  <tr :for-each=${data.rows}>
    <td>${data.name}</td>
  </tr>
</table>
```

The server fetches while it renders, waits, and sends the result with the
page. So the rows are in the served HTML, the browser fetches nothing, and
there is no flash — `${rows}` in the page is `${rows}` in the markup.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `:url` | `""` | Where to fetch. Nothing happens without one. Page-relative is fine. |
| `:client` | `false` | Fetch in the browser instead of while rendering. |

| Reads | Meaning |
| --- | --- |
| `data` | The parsed body, or `null`. |
| `error` | A message, or `null`. A 404 lands here, not in a log. |
| `loading` | True while a *browser* fetch is in flight. |
| `reload()` | Refetch in the browser. |

It renders nothing. It still has to *be* somewhere, and where it is written
is where its name resolves, so put it at the top of the region that reads it.

### The URL means the same thing in both modes

`:url="/people.json"` works served or `:client`, because the component
resolves it against `$origin` — which the server takes from the request and
the browser from `location`. Without that the two would disagree: a server
has no page to be relative *to*, so a bare path there is not a different
address, it is not an address at all.

A URL that *changes* refetches, in the browser, since that is where the
change happened:

```html
<std-data :aka="people" :url=${`/people/${page}.json`} />
```

The first evaluation is the one that differs between the modes. A served
datasource already has its answer and does not fetch again on arrival — that
second request is the thing this design exists to avoid. A `:client` one has
nothing yet, so it does.

### `:client`, and what not to publish

A served result is written into the page as plain text. Anything the page
should not hand to whoever views the source — a session, a credential,
another user's row — belongs behind `:client`, which leaves the render alone
and fetches on arrival:

```html
<std-data :aka="mine" :client :url="/api/me" />
<p>${mine.loading ? 'Loading…' : mine.data?.name}</p>
```

That is the trade the two modes are: `:client` costs a request and a flash
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

## Notes on the awkward corners

- **`:handle-`, not `:did-init`.** The browser fetch hangs off a `:handle-`
  on the resolved URL rather than an init callback, so a `:url` that changes
  refetches instead of being read once. A `_started` flag is what makes the
  *first* call behave differently in the two modes.
- **`_served` is the only value that crosses.** Everything else here is
  derived from it and re-derives in the browser as usual — keep the source,
  never the derivation.
- **The `<script type="application/json">` idea is gone.** An earlier design
  had the component carrying its own payload in its root element. It doesn't
  need to: the result travels in the page's state, so the root is a plain
  hidden `<span>` and the component has no markup contract at all.
