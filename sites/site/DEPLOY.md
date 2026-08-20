# Deploying the site

What runs at [markout.dev](https://markout.dev) is this workspace, in the
image [`Dockerfile`](./Dockerfile) builds, on a [CapRover](https://caprover.com)
server. One app, one container, no database and no volume: everything the site
serves is in the image, and the only state anywhere is the desk demo's list of
tickets, which lives in memory on purpose and is meant to be lost.

Two files are the whole of the deployment configuration:

- [`captain-definition`](../../captain-definition), at the root of the
  repository, which is the file CapRover looks for and whose only content is
  where the Dockerfile is;
- [`Dockerfile`](./Dockerfile), here, built from the repository root because
  the site is one workspace among several and the packages it loads are the
  ones next door.

## What the image is

Two stages. The first installs the three workspaces the site is made of, with
their dev dependencies, and compiles: the compiler and the browser runtime it
serves, the Express middleware, and this directory's `server.ts`. The second
installs the same tree with `--omit=dev`, takes the built output from the
first, and starts `node`. There is no TypeScript in the container -- no
compiler, no `tsx`, nothing between the process starting and the first page
being answered.

The docroot is `/app/public`, and it is NOT the directory the server lives in,
which is what it is in a checkout. Everything under a docroot is servable, so
keeping the code outside one is what makes it impossible to serve the server's
own source, the manifests or the configuration by accident. `server.ts` reads
`DOCROOT` for exactly this.

Build and run it locally, which is worth doing before a deploy that matters:

```sh
docker build -f sites/site/Dockerfile -t markout-site .
docker run --rm -p 3000:3000 markout-site
```

That is the deployed page, at `http://127.0.0.1:3000/` -- served in `--prod`
mode, so the bytes it weighs are the bytes a visitor gets.

## What the container expects

| Variable      | Default        | What it is                                              |
| ------------- | -------------- | ------------------------------------------------------- |
| `PORT`        | `3000`         | the port to listen on, and CapRover's *Container HTTP Port* |
| `DOCROOT`     | `/app/public`  | where the pages are                                      |
| `TRUST_PROXY` | `1`            | how many proxies stand in front -- CapRover's nginx is the one |

All three are set in the image. Nothing has to be configured in CapRover for
the site to come up, apart from the port, which CapRover defaults to 80.

`/healthz` answers `ok` and is the container's `HEALTHCHECK`. It is a route
rather than a page, because an extensionless path is a page request as far as
markout is concerned and a probe every thirty seconds should not be answered
by compiling the homepage.

## Setting it up on CapRover

1. **DNS.** An `A` record for `markout.dev` pointing at the server, and
   another for `www.markout.dev` if the redirect below is wanted. CapRover's
   own dashboard lives on a different name and is already configured; this is
   the app's custom domain, not the CapRover root domain.

2. **The app.** *Apps → One-Click Apps/Databases* is not what this is: create
   an empty app, named `markout` or whatever the dashboard should call it, and
   leave *Has Persistent Data* unchecked. Nothing in the container writes.

3. **The port.** *HTTP Settings → Container HTTP Port* → `3000`. This is the
   one setting that has to be changed, and getting it wrong looks exactly like
   a broken deploy: nginx answers 502 for an app that is running perfectly.

4. **One instance.** Leave the instance count at 1 while the desk demo keeps
   its tickets in memory. Two containers would each hold their own, and a
   visitor's reply would appear and disappear depending on which one nginx
   sent them to.

5. **Deploy.** From a checkout, with the
   [CapRover CLI](https://caprover.com/docs/get-started.html):

   ```sh
   npm install -g caprover
   caprover login          # once per machine
   caprover deploy         # from the ROOT of the repository, not from here
   ```

   From the root, because that is where `captain-definition` is and because
   the build context is the whole tree. `caprover deploy` sends what git
   TRACKS, so an uncommitted change is one that does not go: commit first, and
   a deploy is of a commit rather than of a working copy. The alternative is
   *Deployment → Deploy from Github/Bitbucket/Gitlab* in the dashboard, which
   builds the same two files on a push and needs no CLI at all.

6. **The domain.** *HTTP Settings → Connect New Domain* → `markout.dev`, then
   **Enable HTTPS** (Let's Encrypt, issued on the spot), then **Force HTTPS**.
   Repeat with `www.markout.dev` if that record exists, and turn on
   *Redirect all domains to* `markout.dev` so that one URL is canonical in
   fact as well as in the page's `<link rel="canonical">`.

## After a deploy

```sh
curl -sI https://markout.dev/ | head -1          # 200, and gzip below it
curl -s  https://markout.dev/healthz             # ok
curl -sI https://markout.dev/demos/orbit.html    # the heaviest page in the site
curl -s  https://markout.dev/robots.txt          # names the sitemap
```

The first request for a page compiles it and the rest are served from cache,
so a cold container answers its first hit in tens of milliseconds rather than
in the two or three a warm one takes. Nothing has to be warmed: it is the
difference between fast and imperceptible.

CapRover keeps the previous versions of an app, so a bad deploy rolls back
from *Deployment → Version History* without a rebuild.

## What is published, and what is not

[`robots.txt`](./robots.txt) and [`sitemap.xml`](./sitemap.xml) are served
from the docroot and name `https://markout.dev` absolutely, as does the
homepage's canonical link and its Open Graph card. The card itself is
`social-card.png`, rendered from [`assets/social-card.html`](../../assets/social-card.html)
-- the source is up there with the other logo sources rather than in the
docroot, because it is not a page of the site.

Adding a demo means editing three files: `demos/index.html`, which lists them,
`sitemap.xml`, which is hand-written for the same reason the site is, and the
`Dockerfile` only if the new page needs a file that is not already under
`parts/` or `demos/`.
