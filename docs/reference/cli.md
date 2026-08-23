# Running a page

How a compiled page gets in front of a visitor: served by Node, built ahead
of time, or served by an application that has its own routes. The language
itself is the [syntax reference](syntax.md); this is everything around it.

Which mode you pick decides how much of the page arrives already rendered,
not how it is written — see [two ways to deliver a
page](../../README.md#two-ways-to-deliver-a-page).

## Installing

Two ways, for two kinds of project.

A directory of HTML with no `package.json` around it wants the command on the
PATH, installed once and forgotten:

```sh
npm i -g @markout-lang/cli
```

A project that already has one — anything using kits, since a kit is an npm
package — pins it beside everything else, so that the compiler which builds
the site in CI is the compiler that built it on your machine:

```sh
npm i -D @markout-lang/cli
```

The command is `markout` either way. Installed locally it is on the path
`npm` scripts run with, and `npx markout` finds it from a shell.

### Where kits are found

A kit is looked for in `node_modules`, starting beside the docroot and walking
up — the project's own installs, in other words. Only if that finds no kits
at all are the ones installed alongside the CLI itself used, which is what a
global install produces:

```sh
npm i -g @markout-lang/cli @markout-lang/std-kit
```

That fallback is deliberately all-or-nothing. A project with kits of its own
never reaches past them for a global copy, so what it builds cannot depend on
what happens to be installed on the machine building it — and two copies of
one kit can never both be found, which is an error rather than a choice. The
practical consequence is worth stating plainly: **the moment a docroot has one
kit of its own, globally installed kits stop being visible to it.**

## The `markout/` convention

Name that directory `markout/` and there is nothing to type and nothing to
configure:

```
markout/          your pages
  index.html
  lib.htm
```

```sh
markout          # serves ./markout
markout build    # compiles ./markout into ./dist
```

This is a convention, not a rule — any directory works when you name it. It
earns its place by needing nothing around it: there is no `package.json` in
the layout above, and nothing had to
be configured for either command to know what to do.

It is also what the editor support reads. [The VS Code
extension](../design/editor-support.md) has to resolve `/lib.htm` the same
way the server will, and in a project with no `package.json` the folder name
is the only thing that says where the docroot is. `markout/` rather than
`public/`, `www/` or `static/` for exactly that reason: those belong to every
static-site tool there is, and claiming one would mean guessing at somebody
else's layout.

The CLI accepts an optional port with `-p` or `--port` and uses port `3000` by
default:

```sh
markout ./demo --port 8080
```

`-d`/`--dev` turns on dev mode, which does two things. It surfaces runtime
expression errors instead of only logging them server-side: a page whose
expressions failed during server rendering is replaced by one listing the
errors (no content, no runtime — it would only fail the same way in the
browser), while failures that happen after the page loads appear in a panel at
the bottom of it. And it reloads open pages when anything under the docroot
changes, error pages included, so fixing the file is enough to see the fix:

```sh
markout ./demo --dev
```

`-c`/`--compress` gzips rendered pages and static files for clients whose
`Accept-Encoding` allows it. It's off by default: compressing costs CPU per
request, and behind a reverse proxy that already does it the work would be
done twice.

```sh
markout ./demo --compress
```

## Building static files

`markout build` compiles a docroot ahead of time into a directory you can put on
any host. The source is the first argument and the output the second:

```sh
markout build ./site ./dist
```

Both are optional. The docroot defaults to `./markout` and the output to a
`dist/` *beside* it — beside rather than inside, because a build refuses an
output directory under the docroot: the next run would compile its own output.
So the whole ahead-of-time mode is:

```sh
markout build
```

Each built page carries `<meta name="generator" content="Markout 0.4.0">` at
the end of its `<head>`, unless it already names a generator of its own —
`--no-generator` leaves it out, and the served mode takes the same flag. The
version is the compiler's own, so a page says which release built it.

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
markout ./site                                   # in one terminal
markout build ./site ./dist -o http://127.0.0.1:3000
```

It says what `$origin` is while the pages are built, so a relative `:url`
resolves exactly as it does when served. Any server for the same directory will
do — the one above, or the host the pages are being deployed to. This is what
lets a page fetch its own data and still be a static deployment: the fetching
happens once, here, and what ships is the answer.

`-p`/`--page` restricts the build to one page, and can be given more than once.
A leading slash and the `.html` extension are both optional:

```sh
markout build ./demo ./dist -p index -p /about.html
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

Every page, served or built, loads the runtime from
`/markout-runtime.<hash>.js` — a hash of the bundle itself, so the URL changes
exactly when the bytes do. That is what lets it be served
`Cache-Control: public, max-age=31536000, immutable`: a browser keeps it for a
year and never asks again, where a fixed path had to be revalidated on every
visit and could never safely be given a lifetime at all. It also means a page
can only ever load the runtime it was compiled against, which matters on the
day a props format changes.

It is deliberately not dot-prefixed: a served page has that path *answered* by
the middleware, so it is never a file, but a built page makes it a real file on
somebody else's host — and a dot is what hosts use to decide a file is not for
publishing. GitHub Pages runs Jekyll, which drops dotfiles unless a `.nojekyll`
sits beside them, and denying dot-paths is common server hardening.

A docroot file at the runtime's path is shadowed when serving, which
`markout()` warns about at startup — vanishingly unlikely now that the name
carries a hash, and kept because "unreachable, and nothing said" is what the
warning exists to prevent.

## A CSS build step beside it

Markout does not process CSS, and there is no plugin hook for one. The
reasoning, the measurements behind the rules below, and what was rejected on
the way are in [Tailwind, and utility CSS generally](../design/tailwind-support.md). A tool
like Tailwind, which reads your markup and writes a stylesheet, is a second
command that runs beside `markout` rather than inside it — the two meet in
the `class` attribute, which is a string, and in custom properties, which are
variables. The [Tailwind demo](../../sites/site/demos/tailwind/) is this
section as a page.

**Where the step goes.** Building ahead of time, Markout first and the CSS
tool after, writing into the output:

```sh
markout build ./site ./dist
tailwindcss -i ./site/app.css -o ./dist/app.css --optimize
```

Order is the only trap, and it is the ordinary one: `markout build` writes
the whole output tree, so a CSS step that ran first has its file copied over
or left in a directory that is about to be replaced. Served by Node there is
no output tree, so the stylesheet is written into the docroot as an ordinary
asset and the two commands are independent — `--watch` beside `markout ./site`
for the length of a session.

**What to scan.** Point the tool at the *sources*, not at the built pages:

```css
@import "tailwindcss" source(none);
@source "./**/*.html";
@source "./**/*.htm";
```

`source(none)` turns off automatic content detection, which is worth doing
deliberately here: a Markout docroot usually sits inside a repository holding
a great deal that is not the site, and the detector's job is to guess. The
`.htm` line is the part specific to this compiler — a fragment is source that
reaches the output *inlined into the pages that imported it*, so a locally
defined kit's classes exist only there and a scan of `.html` alone misses
every one of them.

Scanning `dist` instead of the sources is a reasonable *addition* and a bad
replacement. It catches one thing the sources cannot show — a class string
that came out of data, since a built page has the render already in it — and
it misses everything conditional that happened to be off at render time.

**What a scanner sees, and the one thing it does not.** Tailwind reads these
files for candidate strings as raw text rather than parsing HTML, so a utility
written in quotes inside an expression is found exactly as readily as one
written in an attribute. Measured against Tailwind 4.3:

| written | found |
| --- | --- |
| `class="underline"` | yes |
| `class=${'italic'}` | yes |
| `class=${x ? 'lowercase' : 'capitalize'}` | yes, both |
| `class="block ${x ? 'truncate' : ''}"` | yes |
| a literal in a value, read into `class` elsewhere | yes |
| `:class-uppercase=${x}` | **no** |
| `` class=${`line-through-${n}`} `` | no |
| `class=${'ring-' + '4'}` | no |

The last two are Tailwind's own rule about assembling class names, and they
apply here unchanged. The row that is markout's is the toggle: `:class-` puts
the utility in the attribute *name*, so what a scanner reads is
`class-uppercase`, which is not a utility. Nothing is generated, and the page
compiles clean, runs clean, puts the class on and looks unchanged — the
[silent failure](../design/silent-failures.md) shape, arriving from outside
the compiler where nothing here can see it.

Worse than it first looks, because it is not stable. A toggled `ring-1`
survives if some *other* element on the page writes `ring-1` in a plain
`class`, and stops being generated the day that element changes. Both were
true of the Tailwind demo in one build.

So on a page whose CSS is generated, prefer the ternary:

```html
<button class="rounded-full px-5 py-2 ${yearly ? 'bg-brand-600 text-white' : 'text-slate-600'}">
```

It needs nothing added to the stylesheet, and it composes with static classes
in the same attribute.

**Where the toggle is wanted anyway** — and you cannot rewrite one inside a kit
somebody else published — ask the compiler for the names instead of guessing
at them. Two flags, and which one you want follows from what you deploy.

**Deploying the built output.** `--class-manifest` appends a `<template>` to
each page naming the classes its toggles can apply:

```sh
markout build ./site ./dist --class-manifest
tailwindcss -i app.css -o ./dist/app.css
```

The names travel with the page, so scanning `dist/**/*.html` is the whole
configuration — nothing added to the stylesheet, nothing to keep in step. The
template's content is inert (a `<template>` is parsed into a fragment, not the
live DOM), and a page with no toggles gets none. The weight when there are: every
distinct toggle in the whole Bootstrap kit is 35 names, 444 bytes before gzip.

**Serving the sources from Node.** A page compiled per request never lands on
disk, so there is nothing to scan. `--classes-only` produces the scan target in
one pass and writes nothing else — no pages, no assets, no runtime, and no
render, since what classes a page can wear does not depend on one:

```sh
markout build ./site ./.scan --classes-only     # writes .scan/_classes.html
tailwindcss -i app.css -o ./site/app.css
markout ./site
```

```css
@source "./.scan/_classes.html";
```

`.scan/` is a build artifact to ignore, and the generated CSS lands inside the
docroot so the server serves it as an ordinary asset. Re-run it when you add a
toggle or a kit — the manifest is slow-moving, and everything that changes while
you type is found from the sources already.

Both flags read one set, resolved through `<:import>` and treeshaken, so a kit's
toggles are included without your naming the kit and an unused definition's are
not. That is what makes it worth asking the compiler rather than grepping.

**The rule.** A literal class string anywhere in the file is found. A class
named only in a `:class-` toggle, or assembled from pieces, is not — and for the
toggle, the manifest is the answer.

### Checking it in CI

The manifest is also what makes this failure *detectable*, which it was not
before: markout can state the set a scanner cannot see, so "every name in it has
a rule" is a check anyone can run. Nothing here can run it for you — the
stylesheet belongs to another tool and this compiler never sees it — so here is
the check:

```js
// check-classes.mjs — node check-classes.mjs .scan/_classes.html site/app.css
import { readFileSync } from 'node:fs';

const [manifestPath, cssPath] = process.argv.slice(2);
const manifest = readFileSync(manifestPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

const names = (manifest.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);
if (!names.length) {
  console.error(`${manifestPath} is empty -- nothing was checked`);
  process.exit(1);
}

const missing = names.filter(name => {
  const selector = '.' + name.replace(/[.:/[\]()#%,+*~^$|!'"<>=@&{}?\\]/g, c => '\\' + c);
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, c => '\\' + c);
  return !new RegExp(pattern + '(?![\\w-])').test(css);
});

if (missing.length) {
  console.error(`no CSS for: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`${names.length} class name(s) accounted for`);
```

Two things in there are load-bearing and easy to leave out:

- **The empty check.** An empty manifest passes every other assertion, so a run
  pointed at the wrong docroot goes green while testing nothing. That is why
  `--classes-only` also warns when it finds no toggles: a guard that looks
  defended and is not is worse than no guard.
- **The trailing `(?![\w-])`.** Without it `p-1` matches `.p-12` and the check
  quietly stops failing. The escaping above the guard is what a generator does
  to selectors — `px-2.5` is written `.px-2\.5`, `md:grid-cols-3` is
  `.md\:grid-cols-3`.

It is a substring match rather than a CSS parse, which is the right trade here:
it has no dependencies, it reads the stylesheet you actually ship, and the
failure it is looking for — no rule at all for a name — does not need a parser to
find. [demo-tailwind.test.ts](../../packages/cli/test/server/demo-tailwind.test.ts)
is this same check as a test, and it is mutation-tested.

**A kit's classes.** An installed kit is a directory of `.htm` under
`node_modules`, which every content scanner ignores by default and should.
A kit that carries utility classes therefore has to be named:

```css
@source "../node_modules/@markout-lang/bootstrap-kit";
```

**Theming while the page runs.** A generated stylesheet is fixed once it is
written, but the values inside it need not be. Tailwind compiles a theme
entry to a custom property and every utility to a `var()` read of it, so a
page retunes the whole palette by writing the variables — no stylesheet
regenerated, and no class name touched:

```html
<html :hue=${259}>
<head>
  <link rel="stylesheet" href="/app.css">
  <style>
    :root { --color-brand-600: oklch(0.546 0.245 ${hue}); }
  </style>
```

Two details make that work. The rule is **unlayered**, and an unlayered rule
outranks every cascade layer, so it beats the `@layer theme` the generated
sheet puts its own values in without `!important`. And it is a value rather
than a [compile-time constant](syntax.md#compile-time-constants) — `::` is
gone before the page runs and cannot theme anything afterwards — which is
also why it belongs in a `<style>` of its own: [one interpolation makes a
whole sheet reactive](syntax.md#a-stylesheet-is-one-binding), and the
generated one is the last thing you want re-serialized.

## Serving from your own program

The CLI is a thin wrapper over a `Server` class, and most of what an
application needs from a server is a prop on it rather than a reason to build
its own:

```ts
import { Server } from '@markout-lang/cli';

await new Server({
  docroot: `${__dirname}/site`,
  port: 3000,
  hostname: '127.0.0.1',
  trustProxy: true,          // behind a proxy: what `$origin` is built from
  pageLimit: true,           // 300 pages a minute per address
  globals: { db },           // what a `:server-` value may reach
  routes: {
    '/api': myApiRouter,     // the application's own handlers, mounted FIRST
  },
}).start();
```

`routes` is the one that matters most. A page is an extensionless path and so
is most of an API, so the two have to be mounted in the right order — the
application's own routes first, then Markout, then the static files. Passing
them as a prop is what keeps that order the responsibility of the code that
knows it. `init(app, props)` is the same position with the app itself, for
anything that is not a mount, and it may be async so a database opens before
the first request is answered.

`create()` returns the configured app without listening on anything, which is
what a test wants: drive it with supertest and no port is ever bound.

`pageLimit` caps how often one address may ask for a **page** — not for the
application's routes, and not for static files, since one page view pulls a
stylesheet, a script and a dozen images and a shared budget would be spent by
ordinary browsing. A page is the request that costs a render, which is the
thing worth protecting. It is off unless asked for, because a limiter keyed on
the wrong address is worse than none: behind an undeclared proxy every visitor
arrives wearing the proxy's IP and the site rate-limits itself as a whole. Set
`trustProxy` with it — if you don't, and a proxy is there, it says so.

`compress` is the one to think twice about. Anything behind nginx, Caddy, a CDN
or a managed platform is being compressed there already, and compressing twice
buys nothing — the proxy compresses what it receives regardless, so the second
pass is pure cost. It earns its place when the visitor's connection ends at
this server, and for seeing locally what a page really weighs.

`@markout-lang/express` is still there for an application that already has a
server of its own:

```ts
app.use(markout({ docroot }));
```

## Error pages

Put a `404.html` in the docroot and it is what a request for a missing page
gets. It is an ordinary page — compiled and rendered like the rest, so it
carries the same layout, kits and `:server-` values — and it needs no
configuration, because `404.html` is already the name GitHub Pages, Netlify and
S3 look for. A built docroot and a served one show the same page.

```ts
errorPages: {
  notFound: '/errors/gone.html',   // another page; `false` disables the convention
  error: '500.html',               // ready-made HTML for a docroot that will not compile
}
```

The two are configured separately because one of them is rendered while
everything works and the other exactly when something does not. `error` is a
*file*, served verbatim: rendering a page to report that a page could not be
rendered is a loop looking for somewhere to happen.

Outside dev mode a compile error tells the visitor nothing about your sources —
it is a bare 500, or that file. The listing naming the file, line and column is
dev's, and the errors go to the log in **both** modes, since the operator is the
one who can act on them.


## Content Security Policy

A served page carries three `<script>` tags you did not write — the compiled
props, the transferred `:server-` state, and the runtime — plus the live-reload
script in dev. Under a policy without `unsafe-inline` the first two are exactly
what gets blocked, so `csp` gives them a nonce:

```ts
import { cspNonce, markout } from '@markout-lang/express';

app.use(cspNonce());                     // mints it, before anything is written
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    `script-src 'nonce-${res.locals.markoutNonce}'`
  );
  next();
});
app.use(markout({ docroot, csp: true }));
```

That order is not a style. Markout **answers** a page request, so nothing
mounted after it runs, and the header has to go out on the way in — which means
the nonce has to exist by then. `cspNonce()` is what makes it exist that early;
`csp: true` finds it on `res.locals.markoutNonce` and stamps the same value, and
only mints one of its own when nothing already has.

markout stamps its own scripts and does **not** send the header. That is the
whole design: a policy has to cover your images, your styles and your analytics,
none of which this middleware knows anything about, so a framework that writes
it for you gets it wrong. What only markout can supply is the nonce for the
scripts only markout put there — so it supplies that and stops. A fresh one per
response, which is what makes it a nonce.

Where your application already has one — helmet mints `res.locals.cspNonce`
before this middleware runs — pass a function instead, so the page ends up with
one nonce rather than two that disagree:

```ts
markout({ docroot, csp: (req, res) => res.locals.cspNonce })
```

Returning an empty string stamps nothing, which is how a policy that applies to
some routes and not others says so.

`Server` takes the same prop, where `init` is the place for the two middlewares
— it mounts before the pages, which is the order this needs:

```ts
await new Server({
  docroot,
  csp: true,
  init: app => {
    app.use(cspNonce());
    app.use((req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        `script-src 'nonce-${res.locals.markoutNonce}'`
      );
      next();
    });
  },
}).start();
```

There is no `--csp` flag on the command line, and that is deliberate: a nonce is
only worth anything to whoever writes the header, and from a bare
`markout <docroot>` there is nobody to write one. A flag that sent a policy of
markout's choosing would break the first page that carries a `<script>` of its
own — markout does not nonce those, since doing so would make this middleware
the reason an injected script ran.

This is for **served** pages. `build` has no response to mint a nonce per, so a
built site needs its policy written with script hashes instead — the pages are
fixed at build time, which is what makes that possible.
