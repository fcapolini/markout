# Conditional scopes, and modes on an element

Status: **rule 1 built in part; rules 2 and 3 designed, not built.** One crash
found while checking them and fixed on the way (`cae581a`). Prompted by asking
what markout misses next to OpenLaszlo's `<state>` tag — the answer is *not
that tag*.

What rule 1 turned out to be on contact with the runtime, and what that costs
rule 2, is in *What building rule 1 found*. Read it before rule 2, which reads
as ready to build and is not.

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

*Built as far as the lifecycle callbacks; see* What building rule 1 found.

`:if`, `:else-if`, `:else` and `:for-data` are accepted on a `<:logic>`,
**named or anonymous alike**, and a conditional one **disposes and re-inits**
as its condition moves. `:did-init` and `:will-dispose` then bracket what they
always bracket — the scope's lifetime, which is now the condition's. *Built at
the callback level only: the scope itself stays. See* What building rule 1
found.

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
and from a guard inside the handler.

Three things follow, and the third is the one that earns the feature:

- **Listeners register and deregister as a unit**, declaratively, with no
  `addEventListener` in sight.
- **Modal paint is a declaration** rather than a class toggle threaded through
  the markup.
- **Mode-scoped state.** `:_from` belongs to the drag, not to the card. Today
  it has to live on the card and be nulled by hand when the drag ends, which is
  the same bug everybody writes once.

**Decided: a mode may carry only what it can take back.** `:on-` unbinds by
construction. `:class-x` and `:style-x` already have add-and-remove spellings,
so a composition model exists and reverting is defined. Plain attributes,
`:attr-` and `:prop-` have none — reverting means remembering what was there
before, which is state, and two applied modes writing the same attribute makes
it worse. They are refused, the way `<:logic>` refuses what it has no element
for. Additive-only is also the restriction that can be widened later without
breaking a page, which is the direction a rule should be wrong in.

That constraint is what keeps a mode from becoming `<state>` again. `<state>`
bundled markup, attributes, handlers and paint into one togglable container; a
mode is a set of **reversible deltas on an element that stays**, and markup is
not among them — `:if` and `<:group>` already own that question.

**The name.** `<:state>` is the worst of the candidates: values already *are*
state, and every page has them. `<:mixin>` and `<:addon>` suggest composition
that happens once, which is the opposite of a modality. `<:mode>` says the
thing — something an element is in, and can leave.

**A mode can be a component**, and this is the payoff.
`<:define tag="drag:mode">` makes a modality a tag, so a kit ships `<drag>`,
`<sortable>` or `<hover-card>` as declarations that attach behaviour to whoever
contains them. That is [the framework layer living in kits](../concepts/kits.md),
where this repository has already decided it belongs — and it is reachable no
other way, because no kit can add a directive family or bind a listener
conditionally.

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

## What building rule 1 found

The compiler half was three entries leaving `LOGIC_FORBIDDEN_ATTRS`, and the
runtime half is smaller than expected: `showView` and `hideView` already guard
on `this.dom`, and `init` already returns early with no view, so an elementless
region no-ops through all of the machinery that moves markup. What was missing
was only that nothing announced the change, and that is now
`detachSubtree` disposing a scope whose lifetime is its presence, with
`settle` re-initing it when it returns. The reported hole is closed: a timer
opened in `:did-init` is told to stop.

**What is not closed is the scope going away.** A conditional `<:logic>` is a
region **host**, and a host is present whether or not it is showing — the
scope object stays in its parent, keeps its name registered, and its values go
on answering with what they last held. Measured, on a `<:logic :aka="app"
:if=${on} :foo=${5} />` that has never shown: `showing` false, `isStencil`
true, `inited` false, and `app.foo` reads `5`.

That is not a bug in the change. It is how region hosts already work, and
`reachable` documents the same fact as the reason a value **on** a host needs
no guard — a rule with a test of its own.

**So rule 1 as built is lifecycle-level, not existence-level**, and the two
come apart:

| | built | not built |
| --- | --- | --- |
| `:did-init` / `:will-dispose` follow the condition | yes | |
| the scope leaves its parent, unregisters its name, stops answering | | no |

**And that is what rule 2 was resting on.** A guard is the page saying a name
may be absent; while the scope is present and answering, demanding `?.` would
be requiring a check against something that cannot happen, and the message
saying so would be false. Rule 2 is therefore **not built**, and is blocked on
existence-level disposal rather than on any difficulty of its own — the walk
change is four lines and was written and reverted.

Existence-level disposal is the larger piece: removing the scope from
`parent.children`, clearing the name off its host, and rebuilding it on the
way back — which lands in the territory
[re-initializing a value](../explorations/value-reinitialization.md) is parked
on, since a rebuilt scope has to decide what its values start as. That is the
next decision, and it is a real one rather than a chore.

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

## What is still open

These are implementation questions. None of them changes a rule above.

1. **What two modes on one element do about a `:class-` they both set.** A set
   union with removal on the last leaver is the obvious answer and is not
   obviously the right one.

2. **What exactly a mode's element is.** Its nearest element ancestor, which
   makes `<:mode>` at the page root an error with nothing to attach to.
   Whether it reaches through a `<:group>`, and what it means inside a
   `<:define>` whose instances each have their own element, both need saying
   before anything is written.

3. **`:did-init` running more than once.** Today it is *once, when this scope
   has come up*, guarded by an `inited` flag that is never cleared. The rule is
   unchanged — once per lifetime — but lifetimes start multiplying, and
   `inited` has to be reset on dispose. Any `:handle-` on the same scope
   re-runs with it, since it fires once at start.

4. **A mode on the server.** A modality true at render time should arrive
   painted — its `:class-` in the markup — while its listeners stay
   browser-only like every other callback family. That is the existing split,
   but a mode is the first construct where both halves sit in one declaration.

5. **The silent case, before any of this.** `<my-logic :if=${x} />` compiling
   and reporting nothing is what [silent-failures](silent-failures.md) exists
   to hunt. Rule 1 fixes it by making the spelling mean something; the stopgap
   is to refuse region directives on a `:logic`-base usage site. Worth the
   stopgap only if rule 1 is not coming soon, since it forbids the exact
   spelling rule 1 makes correct.

## Order of work

1. **Rule 2's walk correction**, which is a few lines and has its test harness
   already — and is a prerequisite for rule 1 being safe.
2. **Rule 1**, which is the `inited` reset, lifting two entries out of
   `LOGIC_FORBIDDEN_ATTRS`, and disposal on hide for scopes with no `dom`.
   Closes the silent case as a side effect.
3. **Rule 3**, which is a new tag, a new base tag, and the additive-only
   refusal list. Worth starting when a kit asks for it rather than on one
   imagined drag handler — the argument about what a mode may carry will
   outlast the implementation.
