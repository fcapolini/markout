import { CoreGlobal } from './core-global';
import { CoreScope, CoreScopeProps } from './core-scope';
import { CoreValue, CoreValueProps } from './core-value';

export const PROPS_GLOBAL = '__MARKOUT_PROPS';

export interface CoreContextProps {
  root: CoreScopeProps;
  addedGlobals?: { [key: string | symbol]: CoreValueProps<any> };
}

export class CoreContext {
  props: CoreContextProps;
  global: CoreScope;
  root: CoreScope;
  cycle = 0;
  refreshLevel = 0;
  pushLevel = 0;

  constructor(props: CoreContextProps) {
    this.props = props;
    this.global = new CoreGlobal(this, props.addedGlobals);
    this.init();
    this.root = this.newScope(props.root, this, this.global);
  }

  refresh(scope?: CoreScope, nextCycle = true): this {
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
    if (--this.refreshLevel < 1) {
      this.applyPending();
    }
    return this;
  }

  /**
   * Called after Global is created but before scopes are.
   */
  init() {}

  newScope(
    props: CoreScopeProps,
    context: CoreContext,
    parent?: CoreScope
  ): CoreScope {
    return new CoreScope(props, context, parent);
  }

  // ===========================================================================
  // changes batching
  // ===========================================================================
  pending = new Set<CoreValue>();

  applyPending() {
    this.pending.forEach(v => {
      v.cb!(v.scope, v.value);
    });
    this.pending.clear();
  }
}
