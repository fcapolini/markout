# A scope whose lifetime is a condition

Status: **exploratory. Nothing designed, nothing written.** Prompted by a
comparison with OpenLaszlo's `<state>` tag. It ends somewhere else: at a hole
in behaviour that is legal, reachable and silent today, which is the part
worth acting on whether or not anything here is ever built.

## The question

OpenLaszlo had `<state>`: a container holding attributes, methods, event
handlers and child views, which applied all of them to its parent when
`applied` went true and took them all back when it went false. A mode, as one
declaration. The question is whether markout misses it — and the concrete case
is event listeners that should exist only while a scope is in a given mode.

## Most of it is already here, spelled as several things

`<state>` is a bundle. markout has the members of that bundle separately, which
is the language's stated preference — [directives](../concepts/directives.md)
opens by refusing to let one spelling guess between two intents.

| what `<state>` bundled | markout |
| --- | --- |
| child views | `:if` / `:else-if` / `:else`, and `<:group>` where the unit is not an element |
| attributes | `:attr-x`, `:prop-x` |
| classes and style | `:class-x`, `class+=`, `class-=`, `style+=`, `style-=` |
| setup and teardown | `:did-init` / `:will-dispose`, `:did-attach` / `:will-detach` |
| reacting to the mode itself | `:handle-mode=${(m) => …}` |

So a mode that shows different markup, sets different attributes and paints
differently is already one `:if` and a few `:class-`. That part needs nothing.

**The four-way lifecycle is where markout goes past `<state>`.** OpenLaszlo had
one axis — applied or not. markout separates the scope's lifetime from its
markup's presence, because they are different questions. Everything below turns
on that distinction, including the part that is currently broken.

## What is actually missing

One thing: **a listener that exists only while a condition holds.**

`:on-` needs an element, and a handler expression must be a function literal
written at the spot — `${handler}` is
[refused](../reference/syntax.md#values) — so a handler cannot be withdrawn by
making its expression null. Having a listener only sometimes therefore means
having a *scope* only sometimes, or a scope that hears when to let go.

## The obvious pattern is refused, and the way around it is silent

Registering in `:did-init` and unregistering in `:will-dispose`, on a
`<:logic>` under a condition, is the shape that suggests itself. It does not
work, in two different ways.

**A bare `<:logic>` refuses it, loudly and correctly.**

```
<:logic> has no element, so ":if" has nothing to show or hide
```

`:if`, `:else-if`, `:else`, `:for-each` and `:for-data` are all in
`LOGIC_FORBIDDEN_ATTRS` in
[stage1-load.ts](../../packages/core/src/compiler/stages/stage1-load.ts);
`:on-` is in the neighbouring prefix list with *an element to listen to*. A
`<:logic>` is refused *inside* a region too — an `:if`, a `:for-each`, a
`:for-data`, a `<:define>` or a custom tag's content — so that a declaration
reading as one-per-page cannot silently become one per item. The comment there
names the case exactly: *a timer started per row is not something to discover
at runtime.*

**A `:logic`-base component walks straight past all of it.** `tag="x:logic"`
instances are exempt from the placement rule, deliberately: an instance is
written on purpose, and `<std-data :for-each=${urls} />` means what it says.
So this compiles with no error at all:

```html
<div :if=${on}><my-logic ::tag="L" /></div>
```

and then, on mount, hide, and show again:

```
after mount : ["init L"]
after hide  : []
after show  : []
```

One callback, for the life of the page. **The instance hits precisely the
problem the placement rule exists to prevent, and does it quietly.** A timer or
a subscription opened in `:did-init` keeps running while the region is hidden,
and there is no callback that could close it.

Two things cause it, and both are deliberate elsewhere:

- **Hiding detaches; it never disposes.** `CoreScope.toggle` calls
  `detachSubtree()`, and the comment says why: the element moves between the
  document and its stencil, so showing and hiding preserve what the DOM was
  holding — focus, a scroll offset, a playing video. Pinned by *detaches and
  attaches a `:for-data` region without ever disposing it* in
  [lifecycle.test.ts](../../packages/core/test/runtime/web/lifecycle.test.ts),
  whose comment names the trap: *a component that only had `:will-dispose`
  would never hear about this.*
- **An elementless scope never attaches either.** `attachSelf` is gated on
  `domAttached()`, which is `!!this.dom?.isConnected`, and there is no `dom`.
  So the pair that *does* fire per toggle does not fire here.

The first is right, and should stay. The second is the hole: a scope with no
element is treated as *never present*, so neither pair has anything to say
about it and it hears nothing at all. Whether the fix is that it disposes or
that it detaches is the question the rest of this answers.

## What works today, and what it costs

An element-bearing scope in the region, using the markup pair:

```html
<span hidden
      :if=${mode === 'drag'}
      :did-attach=${() => window.addEventListener('pointermove', $._move)}
      :will-detach=${() => window.removeEventListener('pointermove', $._move)} />
```

Correct, and needs nothing new. It costs *an element invented to hold it* —
the exact cost [`<:logic>`](../reference/syntax.md) was added to remove, paid
again one level down.

The alternative is no condition at all: register once, guard inside the
handler. Fine for a click. For `pointermove`, `scroll` or `wheel` it is a
listener firing hundreds of times a second to decide it has nothing to do, and
that is the case that makes any of this worth writing down.

## The shape that would answer it

Not a `<state>` tag. **The name decides**: a named `<:logic>` goes on refusing
`:if`, an anonymous one takes it and genuinely disposes and re-inits as the
condition moves.

Dispose-on-hide looks wrong at first — an elementless scope holds no DOM, but
it does hold *values*, and disposing a `std-data` because its region was hidden
would throw away the rows it fetched and bring them back empty. That objection
is entirely about scopes **other things read**, which is to say named ones. The
name is already the whole difference:

> The name is optional. Values on an unnamed one are reachable from nowhere,
> which is the point when what it declares is **behaviour rather than data**.
> — [syntax reference](../reference/syntax.md), whose example is a timer
> bracketed by `:did-init` / `:will-dispose`

So the split is not a new rule; it is the existing distinction being taken at
its word. **A name is a promise that something is there to answer to it** — the
reason a named scope must not come and go is that `${app.foo}` has to resolve,
and `relinkMaybes` exists to chase precisely those edges. An anonymous one has
no readers *by construction*, so nothing can be left dangling, and what it
declares is the very thing whose lifetime should follow a condition:

```html
<:logic :if=${mode === 'drag'}
        :_move=${(e) => …}
        :did-init=${() => window.addEventListener('pointermove', _move)}
        :will-dispose=${() => window.removeEventListener('pointermove', _move)} />
```

**One rule covers the silent case too.** An anonymous elementless scope is
disposed when it leaves the page and re-inited when it returns — whether the
condition is written *on* it or sits *above* it. That is what
`<my-logic ::tag="L" />` inside `<div :if=${on}>` should have been doing all
along, and it needs no separate mechanism.

### The named half need not be a refusal

A named one could take `:if` too, if every reader had to acknowledge it might
not be there — and **the compiler already knows how to demand exactly that.**
`reachable` in
[stage4-resolve.ts](../../packages/core/src/compiler/stages/stage4-resolve.ts)
walks the chain structurally, finds the region a name lands inside, and returns
one of three answers: `plain`, `refused`, or `guarded`. The guarded one is
`?.`:

```ts
if (!writing && segments[at + 1]?.optional) return 'guarded';
```

So `${app?.foo}` is the checked reference, it is enforced rather than
suggested, and `:for-each` is already `refused` outright with a message
explaining that the name means as many scopes as there are items. Nothing new
has to be invented for the named case: it is the same walk, asked about one
more kind of region host.

Two exemptions in that function are worth reading before changing anything.
Nothing is guarded when read from *inside* the same region, and nothing is
guarded on a *region host itself* — because "that scope exists whether or not
it is showing", which is true precisely because hiding detaches rather than
disposes. A host that genuinely disposed would break that second exemption.
It does not break here, and the reason is the same one as everywhere else in
this document: the scopes that would dispose are the anonymous ones, and
nothing can read them.

## What that leaves open

1. **`:did-init` would run more than once.** Today it is *once, when this
   scope has come up*, guarded by an `inited` flag that is never cleared. The
   rule does not change — once per lifetime — but lifetimes start multiplying,
   and `inited` has to be reset on dispose. Any `:handle-` on the same scope
   re-runs with it, since it fires once at start.

2. **`:for-each` is not `:if`.** The placement rule refuses a `<:logic>` inside
   a region so that *a timer started per row is not something to discover at
   runtime*. Disposal semantics answer the `:if` half of that; they do not
   answer replication, where the objection was never lifetime but arity. These
   can stay separate answers, and probably should.

3. **The silent case is fixed by the same rule**, which is the argument for
   this shape over a blanket refusal. `<my-logic :if=${x} />` compiling and
   then reporting nothing across a toggle is what
   [silent-failures](../design/silent-failures.md) exists to hunt; the cheap
   stopgap is to refuse region directives on a `:logic`-base usage site, and
   the better answer is to make them mean something. Worth doing the stopgap
   only if the rule is not going to be built soon, since it forbids the exact
   spelling the rule would make correct.

4. **`reachable` threw on a first-segment reference. Fixed.** Found while
   checking the above, and unrelated to anything proposed here:

   ```html
   <div :if=${on}><span :aka="inner" :x=${5}>i</span></div>
   <p>${inner.x}</p>
   ```

   crashed the compiler with `TypeError: Cannot read properties of undefined
   (reading 'name')`. The cause was `const through = segments[at - 1].name`,
   whose comment asserted *there is always a previous segment* — which does
   not hold when the name landing inside the region is the chain's first
   segment, and that is the case whenever **the region host is unnamed**.
   `${panel.field.text}` was fine; `${field.text}` was not, and neither was
   `${field?.text}`, because the name was built before the guard was checked —
   so the crash landed on the one spelling that was meant to be accepted, and
   the `:for-each` branch died before printing the good message it had ready.
   Now a `via` fragment that is empty at the first segment, so the two
   wordings differ only in naming a crossing that exists. Four cases in
   `name-resolution.test.ts` cover it; the named-host wording is unchanged.

4. **Is one listener worth a language change?** The feature is not "modes" — it
   is removing the invented element from the working pattern above. If that
   pattern is rare, this is not worth building; if drag, resize and scroll
   modes turn out to be common in kits, it is. That is a question about real
   pages, and there are not enough of them yet.

5. **A kit cannot do this**, which is worth stating because
   [kits are where framework-shaped things belong](../concepts/kits.md). A kit
   can wrap the `<span hidden>` behind a tag — a real improvement, available
   today. What it cannot do is remove the element or change what a region does
   on hide.

## The recommendation

**No `<state>` tag.** It bundles what this language deliberately keeps apart,
and four of its five members are already here and orthogonal.

**Yes to the thing found underneath it**, which is narrower and better formed
than the tag that prompted it — and which is a defect rather than a wish: an
elementless scope hears nothing when the region around it comes and goes, so it
cannot release anything it acquired.

The rule that answers it is small, and it is a distinction the language already
draws: **named means someone may be reading you, so either stay, or make every
reader say `?.`; anonymous means you are behaviour, so come and go with your
condition.** The enforcement half of that already exists and is already
enforced — which leaves less to build than the question suggested, and one
crash to fix first.
