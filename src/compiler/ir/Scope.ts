import { ServerElement } from '../../html/server-dom';
import type { Page } from './Page';
import type { Value } from './Value';

export class Scope {
  page: Page;
  id: string;
  parent?: Scope;
  children: Scope[];
  values: Map<string, Value>;
  textValues: Map<string, Value>;
  textCount: number;
  e?: ServerElement;
  name?: string;
  /** set for a custom-tag usage scope: the id of the <:define> scope it instantiates from */
  usesTemplate?: string;
  /** plain attributes supplied at a custom-tag usage site */
  attributes?: Map<string, string | null>;
  /**
   * Names in `values` that were written at the usage site rather than in the
   * <:define> body (`<my-card :title=${data.t} />`). They live here so the
   * definition can read them, but an expression evaluates where it was
   * written -- this one has to see the call site's `data`, while the
   * definition's own expressions must not see the call site at all.
   */
  callSiteValues?: Set<string>;

  constructor(page: Page, parent?: Scope, e?: ServerElement, name?: string) {
    this.page = page;
    this.id = page.createScopeId();
    this.parent = parent;
    this.children = [];
    this.values = new Map();
    this.textValues = new Map();
    this.textCount = 0;
    this.e = e;
    this.name = name;
    parent && parent.children.push(this);
  }
}
