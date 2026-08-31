# Conditional scopes, and modes on an element

Status: **rules 1 and 2 built; rule 3 begun — handlers, children, classes.** One crash found
while checking them and fixed on the way (`cae581a`). Prompted by asking what
markout misses next to OpenLaszlo's `<state>` tag — the answer is *not that
tag*.

*What building rules 1 and 2 found* records what changed on contact with the
runtime, including the reason the two cannot be built separately.

## The gap

Two ways of saying it, and the second is the one that matters.

**Narrow:** a listener that exists only while a condition holds. `:on-` needs
an element, and a handler expression must be a function literal written at the
spot — `${handler}` is [refused](../reference/syntax.md#values) — so a handler
cannot be withdrawn by making its expression null. Having a listener only
sometimes means having a *scope* only sometimes.

**Wide:** nothing can attach behaviour to an element that **stays**. Every
construct either owns an element or has none, so a change of *modality* — the
same card, now draggable — has no unit to be. `:if` on the element takes the
markup away; a guard inside the handler leaves a `pointermove` listener firing
hundreds of times a second to decide it has nothing to do. That is what
`<state>` was reaching for.

## What is already here

`<state>` was a bundle. markout has its members separately, which is the
language's stated preference — [directives](../concepts/directives.md) opens by
refusing to let one spelling guess between two intents.

| what `<state>` bundled | markout |
| --- | --- |
| child views | `:if` / `:else-if` / `:else`, and `<:group>` where the unit is not an element |
| attributes | `:attr-x`, `:prop-x` |
| classes and style | `:class-x`, `class+=`, `class-=`, `style+=`, `style-=` |
| setup and teardown | `:did-init` / `:will-dispose`, `:did-attach` / `:will-detach` |
| reacting to the mode itself | `:handle-mode=${(m) => …}` |

Four of the five are covered, and the lifecycle pair goes further than
`<state>` ever did: OpenLaszlo had one axis, applied or not, where markout
separates a scope's lifetime from its markup's presence. Everything below turns
on that separation.

## What it did before rule 1, measured

Not argued from the code — run. This is the state the rules were written
against; rule 1 has since changed the first and third of these.

**A bare `<:logic>` refused a condition:**

```
<:logic> has no element, so ":if" has nothing to show or hide
```

`:if`, `:else-if`, `:else`, `:for-each` and `:for-data` were all in
`LOGIC_FORBIDDEN_ATTRS` in
[stage1-load.ts](../../packages/core/src/compiler/stages/stage1-load.ts); `:on-`
is in the neighbouring prefix list with *an element to listen to*. A `<:logic>`
is refused *inside* a region too, so that a declaration reading as one-per-page
cannot silently become one per item — *a timer started per row is not something
to discover at runtime*.

**A `:logic`-base component walks past all of it, silently.** Instances are
exempt from the placement rule, deliberately, so this compiles with no error:

```html
<div :if=${on}><my-logic ::tag="L" /></div>
```

and then reports, across a mount, a hide and a show:

```
after mount : ["init L"]
after hide  : []
after show  : []
```

One callback for the life of the page. **The instance hits exactly the problem
the placement rule exists to prevent.** A timer opened in `:did-init` keeps
running while the region is hidden, and no callback can close it. Two
deliberate behaviours meet to produce it:

- **Hiding detaches; it never disposes.** `CoreScope.toggle` calls
  `detachSubtree()`, so the element moves between the document and its stencil
  and showing preserves what the DOM was holding — focus, a scroll offset, a
  playing video. Pinned by *detaches and attaches a `:for-data` region without
  ever disposing it* in
  [lifecycle.test.ts](../../packages/core/test/runtime/web/lifecycle.test.ts).
- **An elementless scope never attaches either**, because `attachSelf` is gated
  on `domAttached()`, which is `!!this.dom?.isConnected` and there is no `dom`.

The first is right and stays. The second is the hole: a scope with no element
is treated as *never present*, so neither pair has anything to say about it.

## The three rules

### 1. `<:logic>` takes conditionals, and disposes

*Built.*

`:if`, `:else-if`, `:else` and `:for-data` are accepted on a `<:logic>`,
**named or anonymous alike**, and a conditional one **disposes and re-inits**
as its condition moves. `:did-init` and `:will-dispose` then bracket what they
always bracket — the scope's lifetime, which is now the condition's.

The same rule closes the silent case: an elementless scope goes away when it
leaves the page and comes back new, whether the condition is written *on* it or
sits *above* it.

Dispose rather than detach is right here for a reason that does not generalise.
Hiding preserves what the DOM was holding, and an elementless scope holds none
of it. What it holds is values — and whether losing those is a bug depends
entirely on whether anything reads them, which is rule 2's subject rather than
a reason to split rule 1.

`:for-each` stays refused. The objection there was never lifetime but arity: a
name that means as many scopes as there are items is not fixed by knowing when
they end.

### 2. A conditional scope's readers are checked

*Built.*

`${app.foo}` has to resolve. Where `app` may be gone, the page writes `?.` and
reads `undefined` while it is away.

**This is already built.** `reachable` in
[stage4-resolve.ts](../../packages/core/src/compiler/stages/stage4-resolve.ts)
walks a chain structurally, finds the region a name lands inside, and answers
`plain`, `refused` or `guarded` — guarded being `segments[at + 1]?.optional`.
It already refuses `:for-each` outright with a message about a name meaning as
many scopes as there are items. Rule 2 is that walk being asked about one more
kind of host, not a new mechanism.

It needs one correction, which is a consequence of rule 1 rather than an
oversight. **A disposing host loses its exemption.** The walk starts at
`into.parent`, so a value read *on a region host* is never guarded — justified
in its own comment because "that scope exists whether or not it is showing",
which holds precisely while hiding detaches. A `<:logic>` that disposes breaks
it, for the exact shape rule 1 introduces: `${app.foo}` where `app` **is** the
conditional `<:logic>`. The walk has to start at `into` for hosts that dispose.

Worth knowing where that lands: the crossing is then the chain's **first**
segment, `app?.foo`, which is the `at === 0` path — the one that threw
`TypeError: Cannot read properties of undefined (reading 'name')` until
`cae581a`. That fix is a prerequisite for this rule, not a coincidence beside
it. See *What the crash was* below.

### 3. `<:mode>` — a scope on its parent's element

*Begun. The tag carries handlers, children and classes; styles, attributes and
`:priority` are refused in so many words — see* What slice 1 built, What slice
2 needed *and* What classes settled.

`<:logic>` is a scope with **no** element. A mode is a scope whose element is
**its parent's**, so it can carry the families that need one and take them all
back when its condition goes false:

```html
<div class="card">
  <:mode :if=${dragging}
         :_from=${null}
         :on-pointermove=${e => …}
         :on-pointerup=${e => …}
         :class-dragging />
  …the card, which never re-renders…
</div>
```

**The element stays.** That is the whole difference from `:if` on the element,
and from a guard inside the handler. What comes and goes is the delta — and,
where a mode has children, the run of markup it brought with it.

Three things follow, and the third is the one that earns the feature:

- **Listeners register and deregister as a unit**, declaratively, with no
  `addEventListener` in sight.
- **Modal paint is a declaration** rather than a class toggle threaded through
  the markup.
- **Mode-scoped state.** `:_from` belongs to the drag, not to the card. Today
  it has to live on the card and be nulled by hand when the drag ends, which is
  the same bug everybody writes once.

**Decided: a mode owns what it declares, for as long as it is on.** An earlier
draft of this section refused plain attributes, `:attr-` and `:prop-`, on the
grounds that taking them back means remembering what was there before. That
reasoning was wrong, and the cases it excluded are the obvious ones —
`contenteditable` while editing, `draggable` in a drag mode, `aria-grabbed`,
`aria-busy`, `tabindex`, `:attr-disabled` while a form is submitting. Every one
of them is a modality, and refusing all of them would have made the tag answer
only half its own use case.

**Nothing is remembered, because nothing is accumulated.** A markout attribute
is *declared*, not patched: what an element's `title` is, is whatever the
innermost live declaration says. So reverting is not restoring a snapshot, it
is re-running the declaration underneath — and that one is still live the whole
time the mode is on, evaluating as its own dependencies change, simply not the
one writing. A literal on the parent is the same case with a constant
expression, which the compiler already knows.

So an attribute has **one owner at a time**, the innermost active declaration,
and a mode takes ownership while it is on and hands it back when it goes. That
is a layering rule rather than a composition rule, and it is the right shape
for single-valued things. `:class-` and `:style-` keep composing as sets, since
add-and-remove is what they already mean.

**Two modes contending for one attribute: equal ranks refuse, declared ranks
decide.** A mode may carry `:priority`, and leaving it off is the default that
every mode shares. Two modes at the same priority declaring the same
single-valued attribute is a compile error — same element, same name,
statically detectable. Give them different priorities and the higher one owns
the attribute while both are on, with the lower resuming when it leaves, which
is the layering rule again one step along.

```html
<div class="panel">
  <edit :if=${editing} />
  <drag :if=${dragging} :priority=${1} />   <!-- drag's disabled wins -->
</div>
```

**A number, and a higher one wins.** Absent is the shared default, which
compares as zero, so an unranked mode ties with another unranked one and is
beaten by any positive rank. It has to be a **compile-time constant**, or the
conflict check stops being one: a rank that is an expression could tie at
runtime, and the error this exists to give would arrive as a silent
last-write-wins instead.

**Opt-in is what makes a number acceptable here.** The objection to priorities
is the arms race that ends at 9999, and it applies to systems where every
participant must pick one to be heard. Nothing needs a priority to work; it
exists only where two modalities genuinely overlap, which is rare and is
exactly where the author has something to say that the language cannot infer.
The safe answer stays the default and the escape is explicit — the shape
`class+=` and `class!=` already have.

And the parties are few. Two modes on one element are written by one page
author, or come from one kit; a number needs coordinating when strangers pick
from a shared scale, which is not this. *Higher wins* is the whole rule, and
it does not need a table of conventional values to go with it.

**A relational spelling was the alternative** — `<drag :over="edit" />`, naming
the mode outranked rather than a position on a scale, with cycles refused at
compile time. It has a real property: it is available exactly where precedence
is needed, since component modes are tags and have names, while two anonymous
inline modes are both the page's own and want merging into one expression
rather than ranking. It was not taken because a number is plainer at the point
of use and the coordination problem it avoids is one this construct does not
really have.

**Nesting was the other candidate, and it is not merely worse but wrong** —
worth recording because it looks like the elegant answer: a mode's element is its nearest element *ancestor*, so a mode
could sit inside another and let innermost-win do the work with no new concept.
It fails on something rules 1 and 2 just established. **Nesting already means
lifetime containment** — a scope inside a conditional scope is disposed when
that condition goes false. So writing `<edit><drag /></edit>` to say *drag
outranks edit* would also say *drag exists only while editing*, which is not
what was meant and would be discovered as a bug rather than read as one.
Precedence and lifetime need different spellings because they are different
questions.

The case that made this worth solving at all is **component modes**: where
`<drag>` and `<edit>` come out of a kit, the page owns neither definition, so
"merge the declarations into one expression" is advice it cannot take.
`:priority` is written at the usage site, which is the one place the page does
control.

**Overriding the parent is worth being told about**, and there is a precedent
for exactly that: a usage site whose `class` would replace a component's own
warns, and `class!=` is the spelling that says the replacement is meant. A mode
taking over an attribute its parent declares is the same event one level in,
and should say so the same way.

**A mode takes children, the way `<:group>` does.** An earlier draft refused
them on the grounds that markup in the same container is what made `<state>`
`<state>`. That was wrong, and the mistake is worth naming: the principle this
language actually holds is that *two intents get two spellings* — it disambiguates
declarations, it does not forbid one construct from carrying several kinds.
An element already carries attributes, handlers, classes and children at once.
A mode is the delta an element would have had if it were a different element in
this modality, so it carries what an element carries.

The concrete case is the one that decides it. Editing a panel adds a Save and a
Cancel button as surely as it adds an Escape handler:

```html
<div class="panel">
  <:mode :if=${editing} :_draft=${text} :on-keydown=${…} :class-editing>
    <button :on-click=${() => save(_draft)}>Save</button>
    <button :on-click=${() => editing = false}>Cancel</button>
  </:mode>
  <p>${text}</p>
</div>
```

Without children that is a `<:mode>` and a `<:group :if=${editing}>` side by
side, with **the same condition written twice** and free to drift apart. One
modality is one fact and should be one declaration.

**Its children are built and destroyed, not parked** — and that is the one
place a mode departs from the region machinery rather than reusing it. Every
region markout has today *preserves*: `toggle` moves the element between the
document and its stencil precisely so that a hide keeps focus, a scroll offset,
a playing video. A mode wants the other answer.

Rule 1 disposes an elementless scope on the grounds that it has no DOM state to
preserve, which stops being true the moment a mode has children. **Dispose
anyway**, for two reasons. A mode's state is meant to be transient: the draft
dies with the edit, and a mode that came back holding the last one would be the
surprising thing. And the alternative is a construct that parks its markup
while unbinding its listeners, which is two lifetimes in one tag.

**Arity is not the axis; lifetime is.** `:for-data` is already zero-or-one and
is *not* what a mode wants: `fordataCB` calls the same `toggle` an `:if` does,
`regionHost` counts it among the regions, and a test pins it — *detaches and
attaches a `:for-data` region without ever disposing it*. It parks, like
everything else that shows and hides.

What markout has today is one axis crossed with the other, and one empty cell:

| | parks | builds and destroys |
| --- | --- | --- |
| **zero or one** | `:if`, `:for-data` | *— a mode* |
| **many** | — | `:for-each` |

So a mode wants `:for-each`'s lifetime at `:for-data`'s arity, and no directive
spells that combination. What it does not want is new machinery: a `:for-each`
over a list of zero or one items is exactly build-and-destroy at arity
zero-or-one, and it already works — a dropped replica detaches and then
disposes, which has a test of its own. The cell is empty in the language, not
in the runtime.

The cost is that a mode wrapping a `<video>` or a deeply scrolled list rebuilds
it on the way back. That is the rarer case, and `:if` on the element is still
there for it.

So a mode is not `<state>` for a different reason than the one first given:
not because it carries less, but because what it carries it **owns openly and
hands back**, where `<state>` patched and remembered.

**The name.** `<:state>` is the worst of the candidates: values already *are*
state, and every page has them. `<:mixin>` and `<:addon>` suggest composition
that happens once, which is the opposite of a modality. `<:mode>` says the
thing — something an element is in, and can leave.

**Page code wants this at least as much as a kit does**, and an earlier draft
of this document had it the other way round — worth correcting rather than
quietly fixing, because the mistake had a shape.

The ordinary case is a panel that can be edited. While editing it wants a
click-outside listener and an Escape handler, a class, and two values that
belong to the edit and nothing else: the draft, and the original to restore.
Today all four live on the panel, and ending the edit means remembering to null
each one by hand — the bug everybody writes once, and the reason mode-scoped
state is the argument rather than the listener. A kit author writing a
`<:define>` already has a unit to put that in. A page author has none, so the
construct is worth *more* to the page, not less.

**A mode can also be a component**, which is the further payoff rather than the
justification. `<:define tag="drag:mode">` makes a modality a tag, so a kit
ships `<drag>`, `<sortable>` or `<hover-card>` as declarations that attach
behaviour to whoever contains them — [the framework layer living in
kits](../concepts/kits.md), where this repository has already decided it
belongs.

**The gate this replaces was unsatisfiable**, which is what made it wrong
rather than merely cautious. "Build it when a kit asks" wanted a signal from
the one direction that structurally cannot send one: no kit can add a directive
family or bind a listener conditionally, so a kit cannot demonstrate the need
by hitting it. The signal can only arrive as page-level pain, and waiting for
it to come from kits was waiting for a letter nobody can post.

Most page-level modes will be **anonymous**, which is a happy consequence: no
name to reach, so rule 2 never comes up. A named one — `<:mode :aka="edit">`
with the page reading `edit?.draft` — is a conditional scope like any other,
and is already covered by rules 1 and 2 as built.

## Why not `<state>`

Recorded because it was the question, and because the answer is a design
principle rather than a preference. `<state>` is one container holding four
unrelated powers, toggled together. markout spends its design budget on the
opposite: two intents get two spellings rather than one guessing from the shape
of a value. Re-admitting the bundle would undo `:attr-` versus a plain
attribute, `:class-x` versus `class+=`, and `:if` versus `:for-data` in a
single tag.

What `<state>` had that markout lacks is not the bundle but the *target* — a
delta applied to something that already exists. Rule 3 takes that and leaves
the rest.

## What building rules 1 and 2 found

**Neither is separable from the other**, which was not obvious from the design
and is the main thing to record.

The compiler half of rule 1 was three entries leaving `LOGIC_FORBIDDEN_ATTRS`.
The runtime half is smaller than expected, because the machinery that moves
markup already copes with there being none: `showView` and `hideView` guard on
`this.dom`, and `init` returns early with no view. What was missing was that
nothing announced the change, so `detachSubtree` now disposes a scope whose
lifetime is its presence and `settle` inits it again on the way back.

**Then rule 1 alone turned out to be a half-truth.** A conditional `<:logic>`
is a region *host*, and a host stays present with its name registered: the
callbacks fired, and `app.foo` went on reading `5` while the condition was
false. The fix was not to tear the scope down. `link()` already registers two
kinds of name — a plain one, and a `regionName` that answers `undefined` while
its region is away, which exists so the compiler's `?.` means what it says —
and the only thing missing was that `regionHost()` starts the search at
`this.parent`, so a scope that IS the region got the plain kind. Starting at
`this` for an elementless host is the whole of it, and `rendered()` already
returns false for a scope that is its own stencil.

**And then rule 2 turned out to be load-bearing rather than protective.** With
the name correctly absent, the guarded read still answered `away` forever:
classifying a read as `guarded` is what registers the reader as a *maybe*, and
maybes are what `relinkMaybes` walks when a region returns. Called `plain`, the
read is evaluated once against a name that is not there yet and never asked
again. So rule 2 is not a check bolted onto rule 1 — it is how a reader is
wired into the toggle at all, and building either without the other leaves a
page that is quietly wrong.

**One thing had to be said explicitly rather than inferred.** `elementless` is
now a prop the generator writes, not a `!this.dom` test, because `link()` runs
before `init()` — a scope that has not looked for its element yet is
indistinguishable from one that will never have one, and the name is
registered during `link`.

The element case is untouched throughout, and has guard tests either side: an
element region still reports detach and attach with no dispose, and a value on
an element host still reads unguarded.

## What the crash was

`reachable` built its "through" name from `segments[at - 1]`, under a comment
asserting there is always a previous segment. That holds only while the region
host is **named**: `panel.field.text` crosses at the second segment, but with
an unnamed host the same scope is reached as `field.text` and the crossing is
the first, so the lookup ran off the start of the chain and threw out of the
compiler. `${field?.text}` threw as well, because the name was built above both
the `:for-each` refusal and the `guarded` return — **the crash landed on the
one spelling the rule exists to accept**, and the `:for-each` branch died
before printing the message it had ready.

Fixed by a `via` fragment that is empty at the first segment, so the two
wordings differ only in naming a crossing that exists; the named-host wording
is byte-identical. Four cases in `name-resolution.test.ts` cover it.

## What slice 1 built

`<:mode>` is a tag, it borrows the nearest element above it, and its `:on-`
handlers go on and come off as its condition moves. That is the gap this
document opened with, and it is closed: a `pointermove` handler can now exist
only while a drag is happening, on an element that never re-renders.

**Handlers first because they need no ownership model.** Binding and unbinding
are unambiguous, where a class is a set the element's own scope is already
diffing — `applyClasses` computes a want-set from what it last applied — and
two scopes diffing one `classList` is the question the next slice is about.
Attributes are the same question. So `:class-`, `:style-`, `:attr-`, `:prop-`
and plain attributes are all refused *as not built yet*, each saying which,
rather than half-applied.

Three things it needed that were not obvious:

- **The parent element has to be given a scope.** A plain `<div>` needs none of
  its own, so a mode inside one would have borrowed whatever scoped ancestor
  came next and painted `<body>`. `needsScope` now looks for a `<:mode>` child.
- **Everything that disposes a scope removes the DOM that scope owns**, and a
  mode owns none of it — so `dispose`, `showView` and `hideView` all return
  early for one. Getting this wrong takes the parent's element out of the page,
  quietly, on the way past.
- **Re-arming re-adds rather than rebuilds.** A value binds its listener in the
  branch that runs when the value is first *constructed*, and a mode coming
  back re-evaluates its values rather than rebuilding them. So the list is kept
  and re-added, which is why `lifetimeBegun`/`lifetimeEnded` exist beside the
  callbacks rather than inside them: what a mode declared has to be bound
  whether or not the page declared a `:did-init`.

Rules 1 and 2 carried more of this than expected. A mode is marked
`elementless`, so its lifetime already follows its condition and its name is
already absent while it is off, with the reader wiring that goes with that.

## What slice 2 needed

Children are built, and the desugar is the whole idea: `:if=${c}` on a mode
with children becomes `:for-each=${(c) ? [0] : []}` on the same attribute,
rewritten as an AST rather than as text, the way `desugarHandler` already
rewrites one. Everything downstream then does the right thing without knowing
a mode was involved — a stencil, a replica built when it exists and disposed
when it does not, and `clone()` as the DOM-creating primitive a rebuild needs
and a park never had.

**The first attempt reverted**, and the reason is worth keeping: made a region
instead, its children *parked*, so they came back holding the last modality's
draft while `:will-dispose` had said they were gone. That is a decision
reversed by accident, and the desugar is what makes the decision true.

Four things it needed beyond the idea:

- **`clone()` lists props rather than spreading them**, so `mode` was silently
  absent from every replica — reported as a handler that found no element to
  bind on. Anything a mode adds to props has to be named there too.
- **A replication host must not bind.** It borrows the same element its replica
  does, so both bound and the page saw every event twice. Asked of `:for-each`
  rather than of `isStencil()`, which is also true of a region not showing yet
  — and a childless mode is its own region host, so that reading bound nothing
  at all.
- **`lifetimeBegun` must re-arm only what it disarmed.** A mode with children
  is rebuilt from scratch and binds as it goes; re-adding there was the same
  double-binding by another route. A childless one is the case the hook exists
  for, since the same scope returns and its values are re-evaluated rather than
  rebuilt.
- **A borrowed element is protected below the range, not above it.** `dispose`,
  `showView` and `hideView` each have a group branch and an element branch; the
  mode guard belongs after the first and before the second, or a mode with
  children never takes its own markup away.

One thing the compiler had to be told rather than work out: `elementless` is
decided by markup children, not by child scopes. A mode whose children are
plain markup has no child scopes at all — their text values land on the mode's
own — so counting scopes called it elementless and gave it a second lifetime it
did not need.

## What classes settled

`:class-` works, and it turned out to need none of the ownership machinery the
rest of the paint does. Two modes adding a class are not in conflict, and a
mode adding one to an element that has its own is not either — a class list is
a set, and sets compose.

**The whole of it is that a mode's base is empty.** `applyClasses` computes a
want-set and diffs it against what the scope last applied, starting from what
the markup wrote. For a borrowed element that start is wrong: everything
already on it belongs to whoever owns it, so a mode taking it as a base would
adopt those classes and then hand them back or take them away as its own set
moved. Starting from nothing, a mode's want-set is exactly what it declared,
and the element's own scope goes on diffing its own — the two never meet.

**Withdrawing has two sites, because a mode has two ways to end.** Childless,
it is disarmed and `lifetimeEnded` takes the paint off; with children it is a
replica and is disposed outright, so `dispose` has to as well. Everything else
that disposes removes the element and takes its classes with it, which is why
that second site did not already exist.

This is also why `:style-` did not come with it. A style property is
single-valued: two declarations of `color` need an owner in a way two
declarations of a class never do, so it belongs with the attributes rather than
with the classes it is spelled like.

## What is still open

These are implementation questions. None of them changes a rule above.

1. **What two modes on one element do about a `:class-` they both set.** A set
   union with removal on the last leaver is the obvious answer, and is probably
   right here where it was not for attributes: two modes adding a class are not
   in conflict, so there is nothing for a priority to arbitrate and nothing to
   refuse. What wants checking is the removal — a class both of them add, and
   one of them leaves.

2. **A priority is per mode, and a conflict is per attribute.** One number
   cannot say that `<edit>` should win `disabled` while `<drag>` wins
   `aria-grabbed`. That is probably a design smell rather than a case to
   support — a modality that outranks another on one attribute and loses on
   the next is two modalities wearing one name — but it is an assumption, and
   the first page that wants it will say whether it was right.

3. **What the override signal is, exactly.** A mode taking an attribute its
   parent declares is legitimate and worth saying, on the `class!=` precedent —
   but whether that is a warning, a spelling, or both is not settled, and the
   answer wants to be the same one `class!=` gives rather than a second
   dialect.

4. **What exactly a mode's element is.** Its nearest element ancestor, which
   makes `<:mode>` at the page root an error with nothing to attach to.
   Whether it reaches through a `<:group>`, and what it means inside a
   `<:define>` whose instances each have their own element, both need saying
   before anything is written.

5. **`:did-init` running more than once.** Today it is *once, when this scope
   has come up*, guarded by an `inited` flag that is never cleared. The rule is
   unchanged — once per lifetime — but lifetimes start multiplying, and
   `inited` has to be reset on dispose. Any `:handle-` on the same scope
   re-runs with it, since it fires once at start.

6. **A mode on the server.** A modality true at render time should arrive
   painted — its `:class-` in the markup — while its listeners stay
   browser-only like every other callback family. That is the existing split,
   but a mode is the first construct where both halves sit in one declaration.

## Order of work

1. ~~Rule 2's walk correction.~~ **Built**, and not separable from rule 1 —
   see *What building rules 1 and 2 found*.
2. ~~Rule 1.~~ **Built.** It closed the silent case that opened this document:
   `<my-logic :if=${x} />` compiled and reported nothing across a toggle, which
   is the shape [silent-failures](silent-failures.md) exists to hunt, and now
   the spelling means something.
3. **Rule 3**, which is a smaller delta than when this was written. A mode is a
   conditional scope that borrows its parent's element, and conditional scopes
   are done: lifetime, disposal, name absence and reader wiring all arrive from
   rules 1 and 2. What is left is the tag and its base tag, binding the
   element-needing families to the parent's element, taking them back on
   dispose, and the refusal list.

   No longer gated on a kit asking, for the reason under rule 3. What to settle
   first is not scheduling but scope: what a mode may carry, and what two of
   them on one element do about it.
