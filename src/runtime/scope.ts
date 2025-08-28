import { Context } from "./context";
import { Value, ValueProps } from "./value";

export interface ScopeProps {
  id: string;
  name?: string;
  open?: boolean;
  children?: ScopeProps[];
  values?: { [key: string]: ValueProps<any> };
}

export class Scope {
  props: ScopeProps;
  context: Context;
  values: { [key: string | symbol]: Value<any> };
  proxy: { [key: string | symbol]: any };

  constructor(props: ScopeProps, context: Context, parent?: Scope) {
    this.props = props;
    this.context = context;
    this.values = {};
    this.proxy = new Proxy(
      this.values,
      {
        get: (_target, prop) => {
          if (prop in this.values) {
            return this.values[prop].get();
          }
          return undefined;
        },
        set: (_target, prop, value) => {
          if (prop in this.values) {
            this.values[prop].set(value);
            return true;
          }
          return false;
        },
      }
    );
    if (props.values) {
      for (const [key, valProps] of Object.entries(props.values)) {
        this.values[key] = new Value(valProps, this);
      }
    }
  }
}
