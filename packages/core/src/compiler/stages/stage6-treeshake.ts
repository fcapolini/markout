import { NodeType } from '../../html/dom';
import type {
  ServerElement,
  ServerNode,
  ServerText,
  ServerTemplateElement,
} from '../../html/server-dom';
import { CLASS_VALUE_PREFIX, type Page } from '../ir/Page';
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
 * A definition's own `<style>`s go with it, for free: stage1 lifted them
 * out of the stencil so they are served once, and `page.defineStyles` says
 * which belong to whom. No annotation is involved, which is what separates
 * this from the `:when-used` case below -- a stylesheet written inside a
 * `<:define>` is that component's as a matter of where it is, not of what
 * someone said about it.
 *
 * What counts as used is REACHABILITY from the page's own markup, walked
 * over `page.tagUses`: the tags the page writes itself, then the tags those
 * definitions' bodies write, and so on. A definition reachable only through
 * one that is itself unused goes with it.
 *
 * The flat `usedTags` set is what this used to ask, and it was wrong in a
 * way that cost more than it looked: `dash-stat`'s body writes
 * `<dash-chart>`, so a page writing neither kept the chart's stencil and
 * its stylesheet — kept them, in fact, on the strength of a mention inside
 * a definition this same pass had just deleted. For a kit whose components
 * compose, which is the ordinary kind, that is not a corner case.
 *
 * Reachability is safe for the reason the flat set was chosen over it:
 * there is no way to instantiate a tag except by writing it, so every edge
 * is in the markup and stage1 recorded them all as it expanded. A cycle —
 * a definition whose body reaches itself — terminates on the visited set
 * and, if nothing outside it writes the tag, is correctly unreachable.
 */
export function stage6treeshake(page: Page) {
  const reachable = reachableTags(page);
  const orphaned = new Map<string, ServerElement[]>();
  for (const [tag, scope] of [...page.customTags]) {
    if (reachable.has(tag)) continue;
    const stencil = page.defineStencils.get(tag);
    stencil?.parentElement?.removeChild(stencil);
    page.defineStencils.delete(tag);
    // the component's own stylesheets, lifted out of that stencil by stage1
    // so they ship once rather than per instance. They go with it and need
    // no `:when-used`: nobody claimed these belong to the component, they
    // were WRITTEN inside it, which is a fact rather than an assertion
    const styles = page.defineStyles.get(tag);
    styles?.forEach(e => e.parentElement?.removeChild(e));
    styles && orphaned.set(tag, styles);
    page.defineStyles.delete(tag);
    page.customTags.delete(tag);
    page.definitionScopes.delete(scope);
    dropUsageStencils(page, scope);
    detach(scope);
  }
  dropUnusedAssets(page, reachable);
  reportOrphanedRules(page, orphaned);
  return page;
}

/**
 * Says so when dropping a definition took styling off markup that stayed.
 *
 * A component's stylesheet names its classes globally — nothing is
 * rewritten or hashed — so a page is free to write `class="card"` by hand
 * without ever writing `<x-card>`. Do both and this pass deletes the rules
 * while the elements wearing them remain: the page renders unstyled, which
 * is the [silent failure](../../../../docs/design/silent-failures.md) the
 * whole `:when-used` argument was about.
 *
 * It fires only when that has actually happened — the definition is gone
 * AND some surviving element still applies the class — so it cannot cry
 * wolf over a page that merely shares a name with a component it does use.
 * The narrower rule is the point: a lint that fires on working pages is how
 * people learn to skip warnings, and this one never does.
 *
 * A warning rather than an error, because the honest fix is a judgement
 * call: write the tag, or move those rules out of the definition and back
 * to the page, and only the author knows which they meant.
 */
function reportOrphanedRules(page: Page, orphaned: Map<string, ServerElement[]>) {
  if (!orphaned.size) return;
  const applied = appliedClasses(page);
  for (const [tag, styles] of orphaned) {
    for (const style of styles) {
      const lost = [...definedClasses(style)].filter(c => applied.has(c)).sort();
      lost.length &&
        page.addWarning(
          `<${tag}> is never used, so its <style> went with it -- but ` +
            `${lost.map(c => `"${c}"`).join(', ')} ${lost.length > 1 ? 'are' : 'is'} ` +
            `still applied by markup that stayed, which now renders unstyled. ` +
            `Write <${tag}>, or move those rules out of the definition`,
          style.loc
        );
    }
  }
}

/** the class names a stylesheet's selectors mention */
function definedClasses(style: ServerElement): Set<string> {
  const text = (style.childNodes as ServerNode[])
    .map(n => {
      if (n.nodeType !== NodeType.TEXT) return '';
      const content = (n as ServerText).textContent;
      // an interpolated stylesheet is never hoisted, so this is always a
      // plain string here -- guarded rather than asserted, since a
      // non-string is a parsed expression and has no classes to read
      return typeof content === 'string' ? content : '';
    })
    .join('');
  const found = new Set<string>();
  // selectors only: everything up to each `{`, so a `url(logo.png)` in a
  // declaration cannot be read as a class named `png`
  for (const block of text.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const selector = block.split('{')[0];
    for (const m of selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) found.add(m[1]);
  }
  return found;
}

/** every class the surviving page applies, statically or by a `:class-` toggle */
function appliedClasses(page: Page): Set<string> {
  const found = new Set<string>();
  const add = (list: string) => list.split(/\s+/).forEach(c => c && found.add(c));
  const walk = (e: ServerElement) => {
    e.className && add(e.className);
    const container = e.tagName === 'TEMPLATE' ? (e as ServerTemplateElement).content : e;
    for (const child of container.childNodes) {
      (child as ServerNode).nodeType === NodeType.ELEMENT && walk(child as ServerElement);
    }
  };
  const root = page.source.doc.documentElement;
  root && walk(root);
  // `:class-x=${...}` never reaches an element's className at compile time,
  // and a toggle is exactly as capable of outliving the rules it turns on
  const scopes = (scope: Scope) => {
    for (const name of scope.values.keys()) {
      name.startsWith(CLASS_VALUE_PREFIX) && found.add(name.slice(CLASS_VALUE_PREFIX.length));
    }
    scope.children.forEach(scopes);
  };
  scopes(page.global);
  return found;
}

/**
 * The tags the page can actually reach, from the ones it writes itself.
 *
 * Breadth is irrelevant and order is not meaningful, so this is a plain
 * worklist over the edges stage1 recorded. `null` keys the uses the page
 * makes in its own markup — including inside a `:if` or a `:for-each`,
 * which are the page's markup however conditionally they render, and
 * inside slotted content, which `collect` attributes to whoever wrote it.
 */
function reachableTags(page: Page): Set<string> {
  const reachable = new Set<string>();
  const queue = [...(page.tagUses.get(null) ?? [])];
  while (queue.length) {
    const tag = queue.pop()!;
    if (reachable.has(tag)) continue;
    reachable.add(tag);
    for (const next of page.tagUses.get(tag) ?? []) queue.push(next);
  }
  return reachable;
}

/**
 * Drops the stencils of instances written inside a definition that is going.
 *
 * `<bs-modal>`'s footer holds a `<bs-button>`, and an instance given content
 * is stamped from a stencil of its own -- appended to `<head>`, beside the
 * definitions', rather than nested inside the one it was written in. So
 * removing the modal's own stencil leaves that button's behind, and nothing
 * can ever stamp it: an instance stencil is reachable only through the
 * `template` its scope's props name, and the scope went with the definition.
 * Two of those were 154 bytes of unreachable markup on a page importing the
 * whole Bootstrap kit and using one alert.
 *
 * Keyed on the scope rather than swept by id, so what goes is exactly what
 * this pass just took the scope for -- the cheap version, "no surviving
 * scope names it", would be a second answer to the same question and this
 * pass's one unacceptable failure is deleting markup a page needs.
 */
function dropUsageStencils(page: Page, scope: Scope) {
  const stencil = page.usageStencils.get(scope);
  if (stencil) {
    stencil.parentElement?.removeChild(stencil);
    page.usageStencils.delete(scope);
  }
  scope.children.forEach(child => dropUsageStencils(page, child));
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
function dropUnusedAssets(page: Page, reachable: Set<string>) {
  for (const [element, tags] of page.whenUsed) {
    if (tags.some(tag => reachable.has(tag))) continue;
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
      // for the reason stage6treeshake does it: an instance's stencil is in
      // <head>, not inside the markup being pruned here
      dropUsageStencils(page, scope);
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
