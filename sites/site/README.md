# The site

The pages that markout's own site is built from, and the demos it serves.
Run it from the repository root with `npm run dev`.

Deployed, it is markout.dev: one container built by [`Dockerfile`](./Dockerfile),
on a CapRover server. [DEPLOY.md](./DEPLOY.md) is how it gets there and what
has to be set for it to come up.

## Orbit

`/demos/orbit.html` is an operations dashboard built out of the Bootstrap
kit -- what those components look like wired to one page's data.

The site is a plain Express app rather than markout's `Server`, because Orbit
is a whole application: it has an API of its own, served from a fake
in-memory database (`orbit-db.ts`), and markout is the middleware that
renders its pages. Orbit reads that API with `std-data` from the std kit,
which fetches while the page renders -- so the served console is complete and
the browser asks for nothing.

Orbit is four files, which is the shape an application takes:
`demos/orbit.html` for its state, layout and logic; `demos/orbit/components.htm`
for the tags it defines on top of the kit's; `demos/orbit/sources.htm` for
where its data comes from; and `server.ts` for its API. The first is imported,
the second included -- a definition wants to arrive once per page however
often it is named, and an instance wants to be spliced exactly where it is
written, because that is where its name resolves.

`orbit/sources.htm` also shows the token pattern working for an application's
own fragment: its root carries `:apiBase="/api"`, which lands on whatever
contains the `<:include>` unless that element declares it, so a page points
Orbit at another host without the fragment changing. That is the same
mechanism as the Bootstrap kit's `bsCssUrl` -- not something kits get and
applications don't.

## Kitchen sink

`/demos/kitchen-sink.html` is every Bootstrap-kit component one after
another, which is what a change to the kit gets checked against.

## Examples

`/examples/` holds the pages framed inside the homepage's code cards. Each
one is a real page of the site, served and opened like any other, and the
sample in the card above the frame is that same file read back with
`<:include ... escaping />` -- so what is shown and what is running cannot
say different things.

They are deliberately not in `sitemap.xml`: they are three-line pages making
one point each, reachable from the card that frames them. They carry no
analytics tag either, for the reason the README demos don't -- every visit to
the homepage loads them, and the pageviews would be the homepage's counted
again.
