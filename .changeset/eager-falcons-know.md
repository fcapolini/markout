---
'@markout-lang/core': patch
---

`URLSearchParams` joins the globals an expression can use, beside `URL`.

`$url.searchParams` already hands pages one, so the type was in the language's
surface and only the constructor was missing — which is what a page needs to
build a query rather than merely read one.
