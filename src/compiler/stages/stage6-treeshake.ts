import type { Page } from '../ir/Page';
import type { Scope } from '../ir/Scope';

/**
 * Stage 6: Drop `<:define>`s no usage site was found for.
 *
 * A kit is imported whole — `<:import src="/bootstrap-kit/all.htm" />` is
 * the documented way to use one — and a page then uses a fraction of it.
 * Every definition it did not use still ships its stencil: the `<template>`
 * holding the component's markup, in the served HTML, for a tag that
 * appears nowhere.
 *
 * Only the stencils. A definition's SCOPE was already absent from the
 * compiled props, which stage7 filters out because a definition is never
 * live at its own position — only instances of it are. So what this
 * removes is markup, not behaviour, and the saving is bounded by what the
 * unused components' markup weighs.
 *
 * Deliberately conservative about what counts as used: a tag is used if
 * stage1 expanded a usage site for it ANYWHERE, including inside another
 * definition's body. So a component only reachable through a definition
 * that is itself unused survives this pass. Removing it too would need the
 * usage graph rather than a flat set, and getting that wrong deletes markup
 * a page needs — the failure this pass must never have.
 */
export function stage6treeshake(page: Page) {
  for (const [tag, scope] of [...page.customTags]) {
    if (page.usedTags.has(tag)) continue;
    const stencil = page.defineStencils.get(tag);
    stencil?.parentElement?.removeChild(stencil);
    page.defineStencils.delete(tag);
    page.customTags.delete(tag);
    page.definitionScopes.delete(scope);
    detach(scope);
  }
  return page;
}

/** takes the scope out of the tree, so nothing downstream can walk into it */
function detach(scope: Scope) {
  const siblings = scope.parent?.children;
  const i = siblings?.indexOf(scope) ?? -1;
  i >= 0 && siblings!.splice(i, 1);
}
