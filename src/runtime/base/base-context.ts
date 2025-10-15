import { BaseGlobal } from './base-global';
import { BaseScope, BaseScopeProps } from './base-scope';
import { BaseValue, BaseValueProps } from './base-value';

export interface BaseContextProps {
  root: BaseScopeProps;
  addedGlobals?: { [key: string | symbol]: BaseValueProps<any> };
}

export class BaseContext {
  props: BaseContextProps;
  global: BaseScope;
  root: BaseScope;
  cycle = 0;
  refreshLevel = 0;
  pushLevel = 0;

  constructor(props: BaseContextProps) {
    this.props = props;
    this.global = new BaseGlobal(this, props.addedGlobals);
    this.init();
    this.root = this.newScope(props.root, this, this.global);
    // this.refresh();
  }

  refresh(scope?: BaseScope, nextCycle = true): this {
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
    props: BaseScopeProps,
    context: BaseContext,
    parent?: BaseScope
  ): BaseScope {
    return new BaseScope(props, context, parent);
  }

  // ===========================================================================
  // changes batching
  // ===========================================================================
  pending = new Set<BaseValue>();

  applyPending() {
    this.pending.forEach(v => {
      v.cb!(v.scope, v.value);
    });
    this.pending.clear();
  }
}
