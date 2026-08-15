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
  /**
   * Set on markup slotted into a custom tag: it lives under the instance
   * (that's where its DOM ends up) but was WRITTEN at the usage site, so it
   * resolves names from there -- the same rule `callSiteValues` applies to a
   * single value, applied to a whole subtree.
   */
  slotted?: boolean;
  /**
   * Took over text written at a usage site without being slotted markup
   * itself -- see rehomeNestedScopes, and CoreScopeProps.slottedText for
   * what the runtime does with it.
   */
  slottedText?: boolean;
  /** where name resolution continues; the structural parent unless slotted */
  lexicalParent?: Scope;
  /**
   * Scopes whose `lexical()` is this one -- i.e. whose `:aka` name was
   * WRITTEN here, whatever subtree their DOM ended up in.
   *
   * The two differ only for slotted markup, which stage1-load moves under
   * the instance it fills. Its name still belongs out here, so resolution
   * has to be able to find it from out here; `children` alone can't say so.
   * Built once, at the start of stage4.
   */
  lexicalChildren?: Scope[];

  /** the scope this one's expressions resolve against */
  lexical(): Scope | undefined {
    return this.lexicalParent ?? this.parent;
  }

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
