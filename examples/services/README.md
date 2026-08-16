# Services

A page whose data comes from a database, with no API between the two.

```sh
npm run dev:services
```

Then read the **source** of the page. The table is in the HTML. What is *not*
in the HTML is how it got there — no query, no table name, no endpoint, and
no fetch for the browser to make.

## What an application adds

One option:

```ts
new Server({
  docroot,
  globals: { db: openDatabase() },
}).start();
```

`db` is then readable from any `:server-` value:

```html
<html :server-fleet=${db.fleet.all()}>
  <body>
    <tr :for-each=${fleet} :for-as="node">…</tr>
```

and from nowhere else. Reading it in a plain value, in text, in an attribute
or in a handler is a **compile error** — not a runtime check, and not a
convention. The compiler is told the names and refuses them anywhere the
browser would go, so the whole guarantee costs one set lookup at build time
and nothing at all afterwards.

That is not a restriction the framework imposes, it is a fact about where the
object lives: nothing could ship a database connection to a browser. What
would otherwise happen is a page that works in dev and is empty in
production.

## Why this example brings its own server

There is nowhere on a command line to put a database handle, so this cannot
be `npm run dev`. That is also the honest picture: `markout` is middleware,
and an application is the thing that hands it its services.

## What to look at

- **[public/index.html](public/index.html)** — the page. Three `:server-`
  values, one of which needs another's result to build its request; the
  render waits for both and arrives complete.
- **[db.ts](db.ts)** — the pretend database. In-memory, and deliberately
  slow, because the waiting is the part that matters.
- **[server.ts](server.ts)** — five lines, most of which is the docroot.

## What the results are, and are not

The *results* travel to the browser like any server value, so they are as
public as the page is. `:server-` is not a privacy boundary on data, only on
code. Anything a given visitor should not see must not be read into a page
they are served — which is the same rule as any other server-rendered page,
and worth saying out loud because the expression being hidden makes it easy
to assume the data is too.
