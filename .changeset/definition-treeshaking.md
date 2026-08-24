---
"@markout-lang/core": patch
---

Drop the stencils of instances written inside a definition that was itself
dropped. Treeshaking removed the `<:define>` and left the `<template>` its
nested usages had been relocated to, so a page shipped stencils for markup
that no longer existed anywhere.
