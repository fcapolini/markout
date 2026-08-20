# Working on the kits

Both published kits live here. This file is for changing them; each kit's own
README is written for someone installing it.

## Running the showcase

```sh
npm run dev
```

That serves [the site](../sites/site/), where the pages built on these kits
live: `/demos/kitchen-sink.html` is every Bootstrap component one after
another, `/demos/orbit.html` is an operations dashboard built out of them,
and `/demos/std/` is the std kit's. Read the **source** of a served std page
rather than the page -- the data is in the HTML, not fetched into it, which
is the whole claim.

## How they are tested

**Bootstrap kit** -- `packages/cli/test/kits/bootstrap-kit.test.ts`, in two
tiers:

- **compiled**, which is most of it: every part compiles on its own, the
  showcase compiles and server-renders with nothing reported, and the id
  wiring is checked mechanically -- every `aria-controls`, `aria-labelledby`,
  `for`, `data-bs-target` and `data-bs-parent` has to name an element that
  exists. That last one is the kit's whole reason for existing, so it is
  worth a test that can't be argued with.
- **live**, in Playwright: the value-driven components actually driven, and a
  stubbed Bootstrap asserting the plugin calls. Skipped when no browser is
  installed (`npx playwright install chromium`).

Nothing reaches the network: the tests set the URL tokens to local files.

**std kit** -- `test/kits/std-kit.test.ts`. Nothing reaches the network
either: `fetch` is a global the runtime reads off `globalThis` when a context
is built, so a test replaces it first -- which is also how a page would
supply its own.
