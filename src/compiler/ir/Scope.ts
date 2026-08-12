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
