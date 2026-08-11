import { PageError, Source } from '../../html/parser';
import { Scope } from './Scope';
import { Value } from './Value';

export const SPECIAL_ATTR_PREFIX = ':';
export const SCOPE_NAME_ATTR = 'aka';
export const CLASS_VALUE_ATTR_PREFIX = 'class-';
export const STYLE_VALUE_ATTR_PREFIX = 'style-';
export const EVENT_VALUE_ATTR_PREFIX = 'on-';
export const TEXT_VALUE_PREFIX = 't$';
// compiled form of the ATTR prefixes above, as stored in Scope.values keys
export const CLASS_VALUE_PREFIX = 'class$';
export const STYLE_VALUE_PREFIX = 'style$';
export const EVENT_VALUE_PREFIX = 'on$';

export class Page {
  source: Source;
  global: Scope;
  defines: Map<string, Scope>;
  values: Map<string, Value>;
  main?: Scope;
  errors: PageError[] = [];
  nextValueId = 0;

  constructor(source: Source, global?: Scope) {
    this.source = source;
    this.global = global ?? new Scope(this);
    if (global) {
      global.page = this;
    }
    this.defines = new Map();
    this.values = new Map();
  }

  createValueId() {
    return `v${this.nextValueId++}`;
  }
}
