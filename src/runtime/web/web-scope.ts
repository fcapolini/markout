import { Element } from "../../html/dom";
import { Scope, ScopeProps } from "../base/scope";
import { WebContext } from "./web-context";

export class WebScope extends Scope {
  dom?: Element;

  constructor(props: ScopeProps, context: WebContext, parent?: Scope) {
    super(props, context, parent);
    this.dom = context.scopeElements.get(props.id);
  }
}
