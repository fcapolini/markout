import { initialize } from "esbuild";
import { Global } from "./global";
import { Scope, ScopeProps } from "./scope";
import { ValueProps } from "./value";

export interface ContextProps {
  root: ScopeProps;
}

export class Context {
  props: ContextProps;
  global: Scope;
  root: Scope;
  cycle = 0;
  refreshLevel = 0;
  pushLevel = 0;

  constructor(
    props: ContextProps,
    addedGlobals?: { [key: string | symbol]: ValueProps<any> }
  ) {
    this.props = props;
    this.global = new Global(this, addedGlobals);
    this.init();
    this.root = this.newScope(props.root, this, this.global);
    this.refresh();
  }

  refresh(scope?: Scope, nextCycle = true) {
    scope || (scope = this.root);
    this.refreshLevel++;
    try {
      nextCycle && this.cycle++;
      scope.unlinkValues();
      scope.linkValues();
      scope.updateValues();
    } catch (err) {
      console.error('Context.refresh()', err);
    }
    this.refreshLevel--;
  }

  /**
   * Called after Global is created but before scopes are.
   */
  init() {}

  newScope(props: ScopeProps, context: Context, parent?: Scope): Scope {
    return new Scope(props, context, parent);
  }
}
