# More than one page

A markout site is a directory of pages, and the answer to "how do I get from
one to another" is `<a href>`. That is not a gap being papered over; it is
the position, and it holds further than it sounds like it does — an ordinary
page compiles in about 2ms, the heaviest page in this repository in about
111ms, and the middleware caches compiled pages, so a render per navigation
is a real answer rather than a resigned one.

But some pages are one screen with several states, and reloading the
document to move between them is the wrong shape. So there are three levels
here, and the first two work today.

## Level 1 — pages are files

Nothing to learn. `about.html` is `/about`, `<a href="/about">` goes there,
the server renders it and the browser gets finished markup. Extensionless
paths resolve to `.html`, so links read the way you would write them.

**What it costs:** a round trip per navigation, and the browser discards
the DOM it had. **What it buys:** every page is correct in the response —
crawlers, link previews, RSS readers and readers without JavaScript all see
the real page, because there is nothing to run.

This is the right level for most sites, and it is where a site should start.

## Level 2 — one page, routed by its query

`std-kit` ships the router. `<std-router>` holds a `<std-route>` per screen,
and the query string says which one shows:

```html
<html>
  <body>
    <std-router>
      <nav>
        <a href="?index" :class-active=${home.selected}>Home</a>
        <a href="?about" :class-active=${about.selected}>About</a>
      </nav>

      <std-route :aka="home" ::page="index">
        <h1>Home</h1>
        <p>Welcome.</p>
      </std-route>

      <std-route :aka="about" ::page="about">
        <h1>About</h1>
        <p>Us.</p>
      </std-route>
    </std-router>
  </body>
</html>
```

**The query is the whole point, and it is what a fragment could not do.** A
browser never sends `#about` to the server, so a fragment-routed page can
only ever respond with its default route and correct itself on arrival —
which a person with JavaScript hardly notices and a link unfurler, an RSS
reader, `curl` or a crawler never gets past. `?about` *is* sent. The server
renders the asked-for route into the response, so everything that reads the
response and stops reads the real page.

It costs nothing on the server to get that. `?about` and `?index` are the
same file, so a host that serves static files already serves every route:
no rewrite rule, no catch-all, nothing to configure. Drop the page anywhere
and every address works.

The same markup is then a single-page app or a multi-page one depending only
on the browser. Where the Navigation API exists the router cancels the
document load and the screen switches in place; where it does not, the click
is an ordinary link and the browser fetches the same file with a different
query, landing on the same route. That is not a fallback path in the
component — there is no second branch — it is what happens when nothing
intercepts. Back and forward work throughout, because they stay the
browser's.

An address can fail to name a page two ways, and they are different
questions. **It can name none** — a bare `/` — which is the front door, and
resolves to `::defaultPage`. **It can name one that does not exist** —
`?abuot`, or `?utm_source=nl` where the query was never a route name — which
is the 404, and resolves to `::fallback`. Both are `index` unless you say
otherwise, so a site wanting neither distinction writes neither:

```html
<std-router ::defaultPage="home" ::fallback="notfound">
```

They are separate so that a visible 404 does not end up at the front door,
which one parameter for both would do. Either way it resolves *while
rendering*, so `?utm_source=nl` on a link to your home page serves the home
page rather than a blank one.

A route publishes `::selected`, which is what the nav above reads, and the
router finds its routes itself — the names are written once, on the routes.

Note what is *not* here. `std-router` is a kit component, not a language
feature: nothing in the compiler knows what a route is, and the same is true
of `std-data` beside it — see
[why anything framework-shaped belongs in a kit](kits.md).

### Two things worth knowing

**`<head>` is outside the router.** `:aka` names resolve where they are
written, so `<head>` cannot read the router's `page`; a `<title>` that
follows the route reads `$url` itself. Nothing else about the head changes —
per-page metadata still needs no API of its own, because a `<title>` is a
value like any other.

**A built page has no address.** `$url` is `undefined` wherever there is
none — `markout build` without `--origin` — so nothing names a page and the
router renders `::defaultPage`, the same answer a bare `/` gets. The address is supplied rather than guessed, for the same
reason the origin is: a build that invented one would be deciding where your
pages live. So `markout build` says so, naming the page and what it renders
instead:

```
route.html: warning: this page reads $url and there is no address to read:
nothing was passed to --origin, so $url is undefined here and whatever the
page derives from it renders as the no-address case. Pass --origin <url> to
say where these pages will live
```

### What level 2 costs

One file carries every route's markup, so a large content site pays for all
of it on the first load — level 1 is the answer there, not a bigger router.
Addresses read `?about/team` rather than `/about/team`. And matching is by
exact name: routers nest, so a section's screens can share a layout, but
there are no parameters, no patterns and no ranking. `/user/42` is level 3's
business.

## Level 3 — the advanced router kit

Routes in the *path* rather than the query, so an address reads `/user/42`:
parameters and pattern matching, ranking between routes that both match, and
a page prerendered per address. That is a kit, not a language feature — see
[why anything framework-shaped belongs in a kit](kits.md).

One thing level 3 will not have to invent: a page can already say what its
response should be. `<html :server-status=${row ? 200 : 404}>` serves the
page with that status and `:server-redirect` answers in its place — see
[the middleware options](../reference/cli.md). A route that turns out not to
exist is a 404 today, without a router.

**It is not built, and that is deliberate rather than pending.** Level 2
covers what most sites want from routing, nested routes included, and what
remains here is the path itself, parameters, ranking and a page prerendered
per address. The design is written down in
[advanced-router-kit.md](../design/advanced-router-kit.md), along with the
five additions to the language it needs — three of which now exist, because
they turned out to be worth having on their own terms: a live `$url`,
`<:group>` regions, and `$outer`.

The reason to stop here rather than push on is that routing is a design
*space* — exact versus pattern matching, nested versus flat, ranking,
guards, scroll restoration — and every framework that guessed at it early
rewrote it later. What exists today carries no such guesses: level 2 works
and nothing in the compiler knows what a route is. When an application needs
level 3, it will say what shape it should be, and the primitives are there to
build it with.

## Choosing

- **A site of pages** — level 1. The response is the page, and there is
  nothing to learn.
- **One screen with several states** — level 2. A dashboard, a console, a
  tool, a small site: the response is still correct, so this is no longer a
  choice against being linked to.
- **Both at once** — level 1 for the pages, level 2 inside the ones that are
  really one screen. They are not exclusive: a routed page is still a page,
  and still served like one.
