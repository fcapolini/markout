
- [ ] import as
  - `<:import src="..." as="foo" />`
  - imported code shouldn't change, but a scope named "foo" should be "interposed"
  - imported code should, at source level, still see its root values unprefixed
  - client code, instead, should see them via the interposed scope
  - e.g. `head.foo.light` instead of `head.light`
  - the objective is of course to prevent name collisions between libraries

- [ ] check rehydration w/ claude: given the same `props`, client side we come up w/ the same values, what will change will be data sources and interaction, correct?
