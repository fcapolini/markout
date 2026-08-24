import { NodeType } from '../../html/dom';
import type { ServerElement, ServerNode } from '../../html/server-dom';
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
  dropUnusedAssets(page);
  return page;
}

/**
 * Drops what `:when-used` was waiting on, once nothing it named survives.
 *
 * The element goes and so does everything the compiler built from it. It
 * runs after the definitions above so it sees the final answer, and it
 * prunes rather than just unlinking: a `<style>` holding an interpolation
 * has a value whose node is inside it, and leaving that behind would emit a
 * binding reaching for markup the page no longer has.
 */
function dropUnusedAssets(page: Page) {
  for (const [element, tags] of page.whenUsed) {
    if (tags.some(tag => page.usedTags.has(tag))) continue;
    prune(page, element);
    element.parentElement?.removeChild(element);
  }
}

/** forgets every value and scope the compiler built inside `root` */
function prune(page: Page, root: ServerElement) {
  const nodes = new Set<unknown>();
  const walk = (n: ServerNode) => {
    nodes.add(n);
    if (n.nodeType !== NodeType.ELEMENT) return;
    const e = n as ServerElement;
    e.attributes.forEach(a => nodes.add(a));
    e.childNodes.forEach(c => walk(c as ServerNode));
  };
  walk(root);

  for (const [id, value] of [...page.values]) {
    nodes.has(value.node) && page.values.delete(id);
  }
  const scopes = (scope: Scope) => {
    for (const child of [...scope.children]) scopes(child);
    if (scope.e && nodes.has(scope.e)) {
      scope.values.clear();
      scope.usageValues?.clear();
      scope.textValues.clear();
      detach(scope);
    }
  };
  scopes(page.global);
  // a value on a surviving scope can still live on a node in here -- a
  // stylesheet's text belongs to the scope that contains it
  const strip = (scope: Scope) => {
    for (const [name, value] of [...scope.values]) nodes.has(value.node) && scope.values.delete(name);
    for (const [name, value] of [...(scope.usageValues ?? [])])
      nodes.has(value.node) && scope.usageValues!.delete(name);
    for (const [name, value] of [...scope.textValues]) nodes.has(value.node) && scope.textValues.delete(name);
    scope.children.forEach(strip);
  };
  strip(page.global);
}

/** takes the scope out of the tree, so nothing downstream can walk into it */
function detach(scope: Scope) {
  const siblings = scope.parent?.children;
  const i = siblings?.indexOf(scope) ?? -1;
  i >= 0 && siblings!.splice(i, 1);
}
