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

## Level 2 — one page, routed by its fragment

A page can read its own address through [`$url`](../reference/syntax.md#origin-and-url),
which is live: a fragment link changes it, and every expression that read it
re-runs. So a `<:group>` carrying an `:if` is a route:

```html
<html>
  <head><title>${$url.hash.slice(1) || 'home'} — site</title></head>
  <body :route=${$url.hash.slice(1) || 'home'}>
    <nav>
      <a href="#home">Home</a>
      <a href="#about">About</a>
    </nav>

    <:group :if=${route === 'home'}>
      <h1>Home</h1>
      <p>Welcome.</p>
    </:group>

    <:group :if=${route === 'about'}>
      <h1>About</h1>
      <p>Us.</p>
    </:group>
  </body>
</html>
```

Nothing in that page is a routing feature. `$url` is a global, `<:group>` is
a region over several nodes, and `<a href="#about">` is a link the browser
follows on its own — no interception, no library, no router. Back and
forward work because they are the browser's. The `<title>` follows because
it is a value like any other, which is why per-page metadata needs no API of
its own.

Deep links work too, with the qualification in the next section: arriving at
`/page#about` shows About.

### What level 2 costs, and it is one thing

**A fragment never reaches the server.** Browsers do not send it. So the
response is always whatever the fragment-less address renders — the default
route — and the browser corrects the page on arrival.

For a person with JavaScript that correction is invisible enough. For
anything that reads the response and stops, it is the whole story:

| reads the response | sees |
| --- | --- |
| a browser | the default route, corrected to the right one on arrival |
| a link unfurler (Slack, Twitter, iMessage) | the default route, always |
| an RSS reader, `curl`, a JS-less reader | the default route, always |
| a search crawler | usually the right one, after it renders — later, and not guaranteed |

So level 2 suits an *application* — a dashboard, a console, a tool — where
every address is behind a login anyway and nobody is unfurling it. It is
the wrong choice for content that gets linked to: a blog, docs, a product
page. Those want level 1, where the response is already right.

One sharp edge worth knowing: `#about` is also an anchor. The browser will
try to scroll to `id="about"` on arrival, before the page has swapped
routes. Fragment-as-route and fragment-as-anchor are competing for the same
string.

## Level 3 — a router kit

Routes in the *path* rather than the fragment, so the server sees which one
was asked for: nested routes composing layouts, parameters (`/user/42`),
prerendering a page per address, and navigation kept in the document with
the Navigation API. That is a kit, not a language feature — see
[why anything framework-shaped belongs in a kit](kits.md).

**It is not built, and that is deliberate rather than pending.** The design
is written down in [router-kit.md](../design/router-kit.md), along with the
five additions to the language it needs — two of which now exist, because
they turned out to be worth having on their own terms: a live `$url`, and
`<:group>` regions.

The reason to stop here rather than push on is that routing is a design
*space* — exact versus pattern matching, nested versus flat, ranking,
guards, scroll restoration — and every framework that guessed at it early
rewrote it later. What exists today carries no such guesses: a fragment-
routed page works and nothing in the compiler knows what a route is. When
an application needs level 3, it will say what shape it should be, and the
primitives are there to build it with.

## Choosing

- **Content anyone might link to** — level 1. The response is the page.
- **An application behind a login** — level 2, if a reload between screens
  is the wrong shape. Everything a browser sees is correct.
- **Both at once** — level 1 for the pages that get linked to, level 2
  inside the ones that are really one screen. They are not exclusive: a
  fragment-routed page is still a page, and still served like one.
