---
"@markout-lang/express": minor
---

Export `isPageRequest` — markout's own rule for what a page request is, so a
rate limiter in front of the pages can agree with the middleware behind them.

The rule (an extensionless path, or a `.html` one) was spelled twice: inline
in the middleware, and again in the CLI's `Server` for its `pageLimit`, whose
comment named the hazard — "the two disagreeing would mean a request that
costs a render and is not counted, or an image that is". A third copy was
about to be written for the site.

It is one definition now, in the module that owns the rule, and both callers
import it.
