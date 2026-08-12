
- [ ] import as
  - `<:import src="..." as="foo" />`
  - imported code shouldn't change, but a scope named "foo" should be "interposed"
  - imported code should, at source level, still see its root values unprefixed
  - client code, instead, should see them via the interposed scope
  - e.g. `head.foo.light` instead of `head.light`
  - the objective is of course to prevent name collisions between libraries

- [ ] check rehydration w/ claude: given the same `props`, client side we come up w/ the same values, what will change will be data sources and interaction, correct?

- [ ] `<:define>`/custom tag instantiation isn't implemented: `<:define tag="theme-switcher:button" ...>` compiles into a dangling scope (never wired to anything), and a usage site like `<theme-switcher />` stays completely inert -- no data-markout id, no class$/event$ bindings, nothing. Confirmed via direct compilation (README.md's "Source level modularity" example). Only `<:import>` (fragment splicing, at the preprocessor level) actually works today.
