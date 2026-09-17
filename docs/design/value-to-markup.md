# Where a value becomes markup

Status: **every surface enumerated, two of them open and named below.** The
surfaces are pinned in
[value-to-markup.test.ts](../../packages/core/test/value-to-markup.test.ts)
and the state blob's escaper in
[serialize.test.ts](../../packages/core/test/render/serialize.test.ts); the
rest of this file is the reasoning and the part deliberately left open.

The neighbouring question to [code-execution.md](code-execution.md). That one
asks whose JavaScript runs where. This one asks whether a string can stop
being a string — whether a value holding `</script><script>alert(1)</script>`
can reach the page as markup rather than as those characters.

It is worth a page of its own because the answer comes from the compiler's
shape rather than from a filter, and a reader who assumes a filter will look
for the wrong things: a sanitizer to configure, an escape hatch to avoid, a
list of allowed tags. There is none of that here, and the two places where
the guarantee genuinely does not hold are not the places a sanitizer would
have missed.

## Why there is nothing to bypass

`${...}` is parsed with [Acorn](https://github.com/acornjs/acorn) and the
page's code is generated from the AST. A value is therefore never spliced
into a string of markup that is then re-parsed. By the time a result exists,
the compiler has already decided what it is a result *for*:

```html
<p title="${label}">${text}</p>
```

is two bindings with two destinations — an attribute on that element, and a
text node between those tags — fixed at compile time and unaffected by
anything either value turns out to hold. `text` is assigned to a text node;
`label` is passed to `setAttribute`. Neither is concatenated with `<p` or
`>`.

That is the whole mechanism, and it is why the usual XSS questions do not
arise in the usual form. A template that builds a string and hands it to
`innerHTML` has to escape correctly *because* the string is about to be
re-parsed, and its escaping is a filter standing between the data and the
parser — a filter that has to be right about which of five contexts the value
landed in, and that a value can be crafted to walk out of. Here the context
is not inferred from the string, it is a property of the binding, and the
parser never sees the value at all.

Two consequences are worth stating because they are what a reader is usually
checking for:

- **There is no raw-HTML escape hatch.** No `v-html`, no
  `dangerouslySetInnerHTML`, no `{@html}`. Not withheld on principle — there
  is nowhere for one to go. A binding's destination is a DOM node, and
  "reparse this as markup" is not something a node does.
- **The runtime never evaluates source.** The props were evaluated by the
  page's own `<script>` before the runtime saw them, which is also what lets
  a page be served under a policy with no `unsafe-eval` — see
  [props.ts](../../packages/core/src/render/props.ts) and
  code-execution.md's browser row.

## The surfaces, one row each

Two deliveries have to be read separately, and only the first is a markup
question. A render writes a *string* that a browser will parse; hydration
writes into a DOM that already exists. The second is safe structurally — a
`textContent` write is not a parse — so where the two columns differ, it is
the served markup that decides.

| a value reaching | rendered markup | in the browser |
| --- | --- | --- |
| a **text node** | escaped `&`, `<`, `>` | `textContent` |
| an **attribute** | escaped `&`, `<`, `"`, and always quoted | `setAttribute` |
| **`<title>`** and other RCDATA | escaped as text | `textContent` |
| **`class`**, via `class+=` and `:class-` | escaped as an attribute | `classList` |
| the **`style` attribute**, `style+=`, `:style-` | escaped as an attribute, but see the second open item | `setProperty` |
| a **`:server-` result** | `quote` + `serialize` + `escapeScriptText` | — |
| a **`<style>` body** | **spliced raw** — see below | `textContent`, inert |
| a **`<script>` body** | not an interpolation surface at all | — |

The escaping is in [server-dom.ts](../../packages/core/src/html/server-dom.ts):
`escape(text, '&<>')` for a text node, `escape(val, '&<"')` for an attribute
value. Attributes are written with double quotes **whatever the source used**,
which is why an unquoted `title=${v}` in the source cannot become two
attributes: the quoting is the serializer's, not the author's.

`<script>` deserves its row. It is in `RAW_TEXT_TAGS`
([parser.ts](../../packages/core/src/html/parser.ts)), so `${v}` in a script
body is those four characters and no binding is made. A page cannot
accidentally compile a value into its own JavaScript, because there is
nothing to compile it into.

### The `:server-` blob is the interesting one

Every other row is author markup receiving a value. This row is *data* —
whatever a `:server-` datasource fetched — crossing into an inline `<script>`
as JavaScript source, which is the one place on the page where untrusted
bytes are written somewhere a `</script` would end the element early.

It is handled with `quote` rather than `JSON.stringify`, and the difference
is exactly the characters that matter: a JSON string is not a JS string
literal and leaves `<` and the two line-terminator code points alone.
`serialize` emits no `<` at all, `escapeScriptText` backs it up for the text
around it, and both are asserted against a list of hostile inputs — a closing
script tag in mixed case, `<!--`, a regexp literal, the payload buried in a
`Map` key, a `URL` carrying it percent-encoded. See
[serialize.ts](../../packages/core/src/render/serialize.ts) and its suite.

Worth naming as the one place that *was* a gap by construction and was
closed, rather than one that never existed: the comment in
[render.ts](../../packages/core/src/render/render.ts)'s `emitState` says so.

## The two that are open

### A value in a `<style>` body is spliced raw

```html
<html :accent=${theme.color}>
  <head><style>:root { --accent: ${accent} }</style></head>
```

If `theme.color` came from somewhere a visitor controls, this is a live XSS
vector. A value holding `red } </style><script>alert(1)</script>` ends the
stylesheet and opens a script, and the served page executes it.

It follows from the HTML spec rather than from an oversight. A stylesheet
holds text that **may not be escaped** — `&` and `<` are literal in CSS, and
`escape`ing a static stylesheet would corrupt it — so `escaping` is off for
the whole element, and an interpolated value inherits that. Escaping only the
interpolated part would mean tracking, per text node, which spans came from
the source and which from a value; they are one concatenated expression by
the time a result exists ([parser.ts](../../packages/core/src/html/parser.ts),
`parseAtomicText`, which sets `escaping` from `RAW_TEXT_TAGS` for the whole
node).

Three things bound it, and the first is the reason this is a caveat and not a
defect notice:

- **It is a rendered-markup vector only.** The same binding in the browser is
  a `textContent` write on a `<style>`, which parses CSS and never HTML. A
  page served with `--client` cannot be reached this way.
- **`:const-` is the usual answer anyway.** The stylesheet case this shape
  comes up in — design tokens — wants
  [`:const-`](../reference/syntax.md#a-stylesheet-is-one-binding), which is
  computed at compile time from literals and cannot hold request data at all.
  A page that reaches for `:const-` for the performance reason has closed this
  by accident.
- **A stylesheet is one binding.** One interpolation makes the whole sheet
  reactive, which is a cost the docs already tell authors to avoid, so the
  shape is rare before anyone thinks about injection.

What it would take to close: the escaping decision moved from the element to
the span — a text node that knows which of its parts are literal — so that a
`<style>` escapes `<` in interpolated segments and nothing else. That is a
change to `parseAtomicText` and `ServerText`, not a filter, and it has not
been made.

Until then: **do not interpolate untrusted data into a stylesheet.** The
element-level surfaces below are a smaller problem than this one, but they
are not a clean answer either.

### A CSS value carrying `;` becomes two declarations

```html
<p style+=${{ color: untrusted }}>
```

with `untrusted` holding `red; background: url(//evil.test/x)` renders
`style="color: red; background: url(//evil.test/x);"`. The server's
`setProperty` ([server-dom.ts](../../packages/core/src/html/server-dom.ts),
`ServerStyleProp`) stores whatever it is given, and `cssText` writes each
pair as `key: val;` without asking whether the value is a single
declaration.

**All three CSS value surfaces do this** — `style+=`, an interpolation in the
`style` attribute, and `:style-name` — because all three end at the same
`setProperty`. Worth stating plainly, since "use one of the others" is the
natural conclusion from seeing one of them and it is wrong.

Smaller than the stylesheet case in two ways. The browser's real
`setProperty` rejects a value holding `;`, so the extra declaration lands in
the served markup and is dropped the moment the page hydrates — making this a
hydration divergence as much as an injection. And a `style` attribute cannot
execute script in any current browser, so the ceiling is CSS: a background
image that phones home, a `position: fixed` overlay. Worth closing, not
urgent.

Closing it is a one-line question on the server side — reject or split a
value containing `;` in `ServerStyleProp.setProperty`, so the server agrees
with the browser it is standing in for. The reason to prefer *reject* is the
divergence rather than the injection: silently keeping a declaration the real
DOM will drop is the failure shape
[silent-failures.md](silent-failures.md) is about.

So the honest rule for untrusted data in CSS is the ordinary one: validate it
where it enters — a hex colour is a regexp — rather than relying on a surface
to contain it.

## What is not filtered, on purpose

**URL schemes.** `<a href="${v}">` with `v` holding `javascript:alert(1)`
renders that href, and clicking it runs the script. React, Vue and Svelte all
do the same, for the same reason: a URL is a string, and which schemes an
application permits is a question about the application. A framework that
guessed would break `mailto:`, `tel:`, `blob:` and every custom scheme
somebody is using deliberately.

So it is the one place where the structural guarantee stops being enough, and
it is an ordinary input-validation question — check the scheme where the
value enters, in the same place the rest of that record is checked.

**Content-Security-Policy.** markout mints a nonce and refuses to write the
header, which is the same reasoning one layer up; see `csp` in
[middleware.ts](../../packages/express/src/middleware.ts).

## What this page is not about

**Authentication, sessions and CSRF.** markout has no position on any of
them, and a page listing them among its guarantees would be claiming a
boundary it does not sit on. The reactive layer covers turning values into
markup; a session is HTTP, and belongs to whatever answers the request.

The seam is worth pointing at, though, because it is where the two meet:
`requestGlobals` hands a page what a request already authenticated, readable
only from a `:server-` value and enforced by the compiler, and
[`:server-if`](../reference/syntax.md#server-if--a-branch-decided-once) keeps
the markup of a branch that did not show out of the page. The auth demo
(`sites/site/demos/auth/`) is those two facts and an Express router, with the
division of labour written down in it.

With one caveat that belongs on this page rather than only in that one,
because a reader who took the sentence above at face value would be wrong
about a security boundary: **`:server-if` does not drop a component used
inside the branch.** The region's own markup goes; a `<:define>` used in it
expands into a stencil of its own, which stays — so the structure behind the
login reaches every visitor if it was built out of kit components. Structure
only, since the branch never rendered, and it is a gap rather than a
decision: it is pinned in
[server-if.test.ts](../../packages/core/test/render/server-if.test.ts) and
listed in [LAST-MILE.md](../../LAST-MILE.md). Until it closes, write the
protected branch in plain markup, which is what the auth demo does and says
why.

One rule does carry over from the table above, and it is the one that catches
people: **a `:server-` result is as public as the page.** Its *expression*
never reaches the browser; its *value* does, in the state blob, where anyone
who views source can read it. `:server-` is not a privacy marker. A secret
stays out of the page, or is fetched with `::client` after the page has
arrived — the way `/me` is in `sites/site/demos/desk/`.
