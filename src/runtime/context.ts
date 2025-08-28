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

  constructor(props: ContextProps, additionalValues?: { [key: string | symbol]: ValueProps<any> }) {
    this.props = props;
    this.global = new Global(this, additionalValues);
    this.root = new Scope(props.root, this, this.global);
    this.nextCycle();
  }

  nextCycle() {
    this.cycle += 1;
    //TODO
  }
}
