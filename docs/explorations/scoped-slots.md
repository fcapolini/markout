# Scoped slots

Status: **exploratory.** Nothing is committed to and no code has been written.
Recorded because the conversation moved a long way from where it started — the
first framing of the idea was wrong about what it costs, and the correction is
the part worth keeping.

## The question

A slot lets a caller supply markup. It does not let the caller supply markup
that the *component* then renders repeatedly, once per item, over data the
component holds. That is what other frameworks reach render props or scoped
slots for, and markout has no spelling for it.

## The line is already drawn exactly here

This is not a greenfield question. A `<:slot>` inside a `:for-each` is
refused today, and the wording says the rest:

```
<my-list>'s slot is inside a :for-each and can't be filled yet
```

The check is in
[stage1-load.ts](../../packages/core/src/compiler/stages/stage1-load.ts), and
the note above it gives the reason: a usage's children are spliced into a
per-**usage** stencil clone, and there is one set of scopes for them, so every
replica would fight over the same ones. A slot inside an `:if` is fine — the
test is specifically for replication.

## What it is for

[`bs-table`](../../kits/bootstrap-kit/parts/table.htm) renders
`${row[column.key]}`, and that is all it can ever render. A caller who wants a
badge in the status column, a link in the name column, or a right-aligned
figure has no way in: the component owns the loop, so it owns the cell, and
text is the only thing it can produce. `bs-list-group` has the same ceiling.

The escape that exists today is for the caller to own the loop instead —
`<my-list><my-row :for-each=${rows}>…</my-row></my-list>` — and it is a good
answer right up to the point where the **component** owns the data: fetches
it, sorts it, pages it. Then the caller has nothing to iterate, and there is
no way to reach the rendering. That is the whole of the gap.

It is worth saying that this lands in a kit rather than in a page. Framework-
shaped features live in kits, and this is the language change that a kit
needs in order to stop being limited to text.

## It is not a hole in the isolation wall

The first objection raised against it was that slotted markup resolving a name
the component provides would breach the rule the language defends at length in
[`$parent` and `$host`](../reference/syntax.md#parent-and-host): a definition
must not read whatever its caller happened to declare, and a caller must not
read the definition's internals.

**That objection is wrong, and the reason is mechanical rather than a matter
of taste.** The wall is `lexicalParent()`, and nothing here touches it. Name
lookup walks `values` and then `lexicalParent()` on each scope in turn; under
this proposal the slotted markup's chain still runs to the call site, and the
component's other values stay exactly as unreachable as they are now. One
value would appear **on** the caller's markup, not be found **through** the
component. That is a declaration, not an inherited name.

And markout already performs this transfer, in the opposite direction. A
`::param` argument's expression evaluates at the *call site* while the value
lives on the *instance* — the mechanism being a per-value flag, `callSite` in
[core-value.ts](../../packages/core/src/runtime/core/core-value.ts), consumed
by `hostFor` in
[core-scope.ts](../../packages/core/src/runtime/core/core-scope.ts), whose
doc comment names it: *the scope a value evaluates against*. `CoreValue` is
handed a different scope from the one storing it. A scoped slot is that same
flag pointed inward.

So the right way to describe the feature is not "an exception to scoping". It
is the outbound half of `::`. A usage site passes arguments **in**; a slot
passes arguments back **out**; neither opens the boundary it crosses.

## The shape

The definition declares what it hands over, and the caller names what it
receives:

```html
<:define tag="bs-table:div" ::rows=${[]} ::columns=${[]}>
  <tr :for-each=${rows} :for-as="row">
    <td :for-each=${columns} :for-as="column">
      <:slot :with=${{ row, column }}>${row[column.key]}</:slot>
    </td>
  </tr>
</:define>

<bs-table ::rows=${rows} ::columns=${cols}>
  <b :slot-as="cell" :if=${cell.column.key === 'status'}
     class=${'badge bg-' + cell.row.status}>${cell.row.status}</b>
  <a :else-if=${cell.column.key === 'name'} href=${'/p/' + cell.row.id}>${cell.row.name}</a>
  <span :else>${cell.row[cell.column.key]}</span>
</bs-table>
```

Three things fall out of writing it this way.

**The slot's existing content is already the fallback**, so `${row[column.key]}`
stays the default and no existing caller of `bs-table` changes. A shipped kit
can gain this without a migration, which is close to a requirement.

**`:slot-as` mirrors `:for-as`**, which exists for exactly this reason. It
could default to `data`, and then the shortest form of the idea —
`<my-list ::list=${…}><div>${data}</div></my-list>` — works with nothing
declared. The argument for naming it anyway is readability: the value's
expression was written by the component, so a reader of the call site cannot
see where it came from, and `:slot-as` at least puts the name being introduced
in front of them.

**`:with` carries more than a loop item**, which the table needs: the innermost
slot sits under two nested loops, and a rule of "you get the enclosing
replica's item" would hand the caller `column` and hide `row`.

A collision — the call site already having a `cell` further out — is ordinary
shadowing, identical to writing `:cell=${…}` on that element by hand. It was
briefly proposed to make that an error. It should not be one; nothing about it
is special.

## Two scopes, pointing opposite ways

[`UsageSiteScope`](../../packages/core/src/runtime/core/core-scope.ts) is
already the shape this needs: a scope with no element, holding a small set of
values, whose `lexicalParent()` is redirected away from its structural
position. Its doc comment reads almost as a specification for the mirror
image —

> A scope of its own rather than a rule on the instance, because the instance
> also holds the definition's values and those must stay invisible from the
> call site — while these must stay invisible from the definition. Nothing
> crosses either way.

— with the two sides swapped: a slot scope whose lookup parent is the call
site, holding one value whose evaluation host is the enclosing replica.

## Dynamic slot names stay refused

The obvious follow-on request is `<:slot name=${column.key} />`, so a caller
can address one column. It should keep being refused —
[`:aka` and `:slot` are literals](../reference/syntax.md#aka-and-slot-are-literals)
— because handing over `column` and letting the caller branch covers the case.

Both halves of that were checked against the compiler, separately, since only
their combination is blocked:

- An `:if` / `:else-if` / `:else` chain written inside a usage site's content
  compiles, links and renders the right branch today. The else-chain survives
  the slot boundary — the emitted props show `elseOf`/`elseNext` threaded
  across three `slotted: true` scopes — and the conditions read call-site
  values normally.
- The same chain inside a `:for-each` re-decides per replica, server-side,
  each replica emitting only its winning branch.

The table cell is those two composed. Two costs come with it, neither fatal
and both worth stating before someone meets them in a profile:

- **Every condition in the chain evaluates per cell.** Each branch is its own
  `if$` value with its own dependency list, so a losing branch still
  evaluates: an N-branch chain is N evaluations per cell, where compile-time
  slot dispatch would be none. Only the winner emits an element, so the
  output stays one node per cell. This is deliberate rather than an
  oversight, and it is what the next section is about.
- **Filling the slot replaces its content entirely**, which is what the next
  section is about.

## What this says about `:switch`

The per-cell cost above is not a wrinkle in the branch machinery, it is the
branch machinery working as designed. `decideBranch` in
[core-scope.ts](../../packages/core/src/runtime/core/core-scope.ts) states the
reason:

> The branches are not dependencies of one another -- an `:else` reads
> nothing, and an `:else-if` reads only its own condition -- so a change in
> the first would wake none of the others... Every condition stays linked
> while its branch is hidden (`liveKeys` keeps `if$`), which is what makes
> reading all of them here answer with this pass's values rather than the
> last pass's.

So a chain costs N reactive values with N sets of dependency edges per
replica, evaluated every pass, and is then re-decided in full. Correct, and
the cost is the price of the correctness.

`:switch`/`:case`/`:default` is postponed rather than rejected -- it is an
item in [TODO.md](../../TODO.md), with the names already reserved and the
semantics already chosen -- and the bar it set itself was that it has to earn
its place against `:else-if`/`:else` rather than merely against `:if`. This
exploration turned up two arguments toward that bar which are worth recording
here even though the feature is out of scope for the work above.

**The alternative that needs no new syntax is the more expensive one.**
Short-circuiting the existing chain -- stop evaluating branches after one
wins -- looks like the obvious optimization, and the comment quoted above is
why it is not. Suppressing later evaluations means either linking branches to
one another, which adds graph rather than removing it, or giving `CoreValue` a
dirty-but-not-evaluated state, which changes the settle loop's invariants. A
new directive family being the *cheaper* route to a saving is unusual enough
to write down.

**The container it costs is, here, the container it wants.** The TODO records
the switch's cost as needing a container element where a chain does not. That
is much cheaper than when it was written, since [`<:group>`](../reference/syntax.md)
renders nothing and already takes the branch attributes -- and in this case it
is not a cost at all, because `:slot-as` has nowhere good to live on a chain.
In the example earlier it sits on whichever branch happens to be written
first, which is arbitrary. On a group it is declared once, where it belongs:

```html
<bs-table ::rows=${rows} ::columns=${cols}>
  <:group :slot-as="cell" :switch=${cell.column.key}>
    <b :case="status" class=${'badge bg-' + cell.row.status}>${cell.row.status}</b>
    <a :case="name" href=${'/p/' + cell.row.id}>${cell.row.name}</a>
    <span :default><:slot-default /></span>
  </:group>
</bs-table>
```

Two cautions against reading this as an endorsement.

The saving depends entirely on **`:case` taking a literal**, like `:aka` and
`:slot`. The property already recorded -- "a non-matching branch evaluates
nothing" -- is about the branch *body*, which is the weaker one. What makes a
switch cheaper than a chain is one reactive value for the subject plus N
literal comparisons; `:case=${expr}` puts all N conditions back and leaves the
chain re-spelled rather than improved. That question is open.

And the magnitude is modest at ordinary sizes: roughly 640 reactive values
against 160 for a 20x8 table with five branches, which is nothing at either
end. It is a large-N story, and large N is where this repository has been
bitten before -- the guard on `for$each` for replicas exists because N wasted
links and N wasted re-evaluations made a 10k-row mount run out of memory.

## The default: a placeholder, not a value, and not an inference

Because filling a slot replaces its content, a caller customizing one column
of eight still has to write the catch-all `:else` and re-state the component's
default rendering. Three answers were considered.

**Infer it.** If the caller's markup produces nothing — every conditional
false — fall back to the slot's own content. **Rejected.** It would be the
first condition in markout whose input is rendered output rather than a value.
Everything that decides existence today (`:if`, `:else`, `:for-data`) is
value-driven and statically declared, with the dependency list emitted
alongside the condition, and the settle loop orders work from those edges; a
grep finds no consumer anywhere of "did that subtree render". It also puts a
definition problem on the caller — "produced nothing" has to mean zero DOM
nodes, so `<span :else></span>` suppresses the fallback while
`<span :if=${false}>` does not, as does stray whitespace — and it quietly
changes what `<:slot>`'s content promises, from *what is here if nobody filled
me* to *…or if what they filled me with came out empty*. Harmless for a table
cell; a silent bug where the fallback is a placeholder or an empty state.

**Hand the default over as a value**, `:with=${{ row, column, text: row[column.key] }}`,
and let the caller write `${cell.text}`. Cheap, needs no language change, and
still worth doing as a kit convention. But it carries a *string*: a component
whose default item is a flex row with a name and a badge cannot express it,
and a caller wanting to keep that default for the columns they did not
customize would have to copy the component's internal markup — the coupling
components exist to prevent.

**A placeholder the caller writes**, as the last branch of the chain, meaning
*the slot's own content, here*. This is the one to build. It is a compile-time
move: `slotUsage` already relocates the caller's children into the slot's
place, and this relocates the slot's content into the caller's markup instead
of discarding it. No runtime condition, no definition of emptiness, and the
contract stays honest — the caller **asks** for the default, in a position
they chose, and a reader of the call site can see it. It is also strictly more
useful than the inferred version, because the default becomes reusable rather
than last-resort: `<b :if=${…}><:slot-default /></b>` wraps it, which taking a
branch could never do under a rule where taking a branch is what turns the
fallback off.

## What has to be decided

1. **Per-replica scopes.** The refusal quoted at the top is the real work and
   nothing above dissolves it: one set of scopes per usage, where the feature
   needs one per replica. Runtime replicas already build their descendants
   from shared props, and `Scope.copy()` already carries the `slotted` flag,
   so the pieces look present — but the refusal is deliberate, and this was
   read rather than proved.

2. **Which direction the default content resolves.** The relocated default is
   the *component's* markup reading the component's names, so it must resolve
   **inward** while sitting inside markup that resolves outward. That is not
   free: `slotted` is a per-scope flag, and a plain nested scope inside
   slotted markup resolves to its parent and so transitively back out to the
   call site. It is the mirror of the slot scope — one points out, one points
   in, same primitive — and the compiler already flips that direction
   mid-walk: `nameSite()` in
   [Scope.ts](../../packages/core/src/compiler/ir/Scope.ts) carries an
   `outside` flag and clears it when the walk crosses into an instance.

3. **Whether the placeholder may appear more than once.** It should. Two
   branches both wanting the default is the natural case — the same shape
   [one name, one slot](../reference/syntax.md#one-name-one-slot) documents
   for slots, where each branch needs one of its own. So the placeholder
   **copies** rather than moves, which is the opposite of `<:slot>` refusing a
   second occurrence of a name. The asymmetry is defensible — a slot's content
   comes from one place and can only go to one place, while a default is a
   source that can be stamped anywhere — but it has to be said out loud in the
   reference or it reads as an inconsistency.

4. **Spelling.** `<:slot>` declares and `:slot="x"` fills; a placeholder is a
   third form for the same concept. Which slot it means is always inferable
   from the enclosing `:slot=` address, so it needs no attribute.
   `<:slot-default />` is the first name that comes to mind rather than
   necessarily the right one.

5. **One documented rule changes.** [One name, one
   slot](../reference/syntax.md#one-name-one-slot) is about arity, and becomes
   *one slot site per name, filled once per replica*. The `$parent`/`$host`
   section does **not** change: what needs writing is a new kind of value, not
   a new exception to scoping.

## Staging

Three separable pieces, in the order they have to land:

1. **Filling a slot inside a replicated region.** Required, and the whole of
   the difficulty. Useless on its own.
2. **`:with` and `:slot-as`.** The point of the feature, and mostly syntax
   given the first. Marginally useful without it — a slot inside an `:if`
   handed a computed value.
3. **The default placeholder.** Ergonomics. Could land a release later without
   stranding anything, and the `text:` convention covers the narrow case in
   the meantime.
