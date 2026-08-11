import { NodeType } from '../../html/dom';
import { ServerAttribute, ServerText } from '../../html/server-dom';
import type { Scope } from './Scope';

export class Value {
  name: string;
  node: ServerAttribute | ServerText;
  scope: Scope;
  id: string;

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
