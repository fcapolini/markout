import { NodeType } from '../../html/dom';
import { ServerAttribute, ServerText } from '../../html/server-dom';
import type { Scope } from './Scope';

/**
 * A `this.foo` (own scope) or `this.<via...>.foo` reference found by stage4.
 *
 * `via` is the chain of scope navigations to walk before looking `key` up --
 * each entry is either `$parent` or a named (`:aka`) scope. It's a list, not
 * a single step, because a source reference can chain arbitrarily deep
 * (`outer.inner.count`, `$parent.$parent.n`); omitted when the reference
 * resolves in the value's own scope.
 */
export interface ValueDepRef {
  via?: string[];
  key: string;
}

export class Value {
  name: string;
  node: ServerAttribute | ServerText;
  scope: Scope;
  id: string;
  /** dependencies extracted by stage4-resolve; empty until that stage runs */
  deps: ValueDepRef[] = [];
  /**
   * Declared `:server-name`: the expression runs on the server only, and the
   * client is handed its result instead of re-deriving it.
   */
  serverOnly = false;

  constructor(name: string, node: ServerAttribute | ServerText, scope: Scope, id?: string) {
    this.name = name;
    this.node = node;
    this.scope = scope;

    const page = scope.page;
    this.id = id ?? `v${page.nextValueId++}`;
    page.values.set(this.id, this);
  }

  get value(): string | object | null {
    if (this.node.nodeType === NodeType.ATTRIBUTE) {
      return (this.node as ServerAttribute).value;
    } else if (this.node.nodeType === NodeType.TEXT) {
      return (this.node as ServerText).textContent;
    }
    return null;
  }
}
