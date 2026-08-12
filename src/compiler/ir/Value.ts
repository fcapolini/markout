import { NodeType } from '../../html/dom';
import { ServerAttribute, ServerText } from '../../html/server-dom';
import type { Scope } from './Scope';

/**
 * A `this.foo` (own scope) or `this.<via>.foo` reference found by stage4,
 * where `<via>` navigates to another scope -- `$parent`, or a named child
 * scope's `:aka` name.
 */
export interface ValueDepRef {
  via?: string;
  key: string;
}

export class Value {
  name: string;
  node: ServerAttribute | ServerText;
  scope: Scope;
  id: string;
  /** dependencies extracted by stage4-resolve; empty until that stage runs */
  deps: ValueDepRef[] = [];

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
