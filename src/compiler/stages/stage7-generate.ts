import { generate } from 'astring';
import type { Node } from 'estree';
import { CoreScopeProps } from '../../runtime/core/core-scope';
import { CoreValueProps, ValueDep } from '../../runtime/core/core-value';
import { EVENT_VALUE_PREFIX, TEXT_VALUE_PREFIX } from '../ir/Page';
import type { Page } from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value, ValueDepRef } from '../ir/Value';

// stage1's compiled prefixes don't all match what WebScope.newValue expects;
// translate the ones that differ (class$/style$ already match).
const RUNTIME_KEY_PREFIX_MAP: [string, string][] = [
  [EVENT_VALUE_PREFIX, 'event$'],
  [TEXT_VALUE_PREFIX, 'text$'],
];

/**
 * Stage 7: Generate the `CoreScopeProps` object literal for the root scope,
 * ready to hand to `new CoreContext({ root: page.props, ... })`.
 *
 * For now every value compiles to `exp` (never `val`), even constants —
 * that optimization is left for later.
 */

export function stage7generate(page: Page) {
  const root = page.global.children[0];
  if (root) {
    page.props = generateScope(root);
  }
  return page;
}

function generateScope(scope: Scope): CoreScopeProps {
  const values: { [key: string]: CoreValueProps<any> } = {};
  for (const [name, value] of scope.values) {
    values[toRuntimeKey(name)] = generateValueProps(value);
  }
  for (const [name, value] of scope.textValues) {
    values[toRuntimeKey(name)] = generateValueProps(value);
  }
  return {
    id: scope.id,
    name: scope.name,
    values,
    children: scope.children.map(generateScope),
  };
}

function generateValueProps(value: Value): CoreValueProps<any> {
  return {
    exp: compileExp(generateExpSource(value)),
    deps: value.deps.map(makeDep),
  };
}

function generateExpSource(value: Value): string {
  const expression = value.value;
  if (expression == null) {
    // a presence-only attribute (e.g. bare `:class-active`) implies `true`
    return 'function () { return true; }';
  }
  if (typeof expression === 'string') {
    // a plain (non-`${}`) value is a static literal, not an expression
    return `function () { return ${JSON.stringify(expression)}; }`;
  }
  const body = generate(expression as unknown as Node);
  return `function () { return (${body}); }`;
}

function compileExp(source: string): () => unknown {
  // the wrapper must be a plain `function`, never an arrow: CoreValue.get()
  // calls it via `.apply(scope.proxy)`, which only a plain function honors
  return new Function(`return (${source});`)() as () => unknown;
}

function makeDep(dep: ValueDepRef): ValueDep {
  const key = dep.key;
  return dep.viaParent
    ? function (this: any) {
        return this.$parent.$value(key);
      }
    : function (this: any) {
        return this.$value(key);
      };
}

function toRuntimeKey(name: string): string {
  const prefix = RUNTIME_KEY_PREFIX_MAP.find(([from]) => name.startsWith(from));
  return prefix ? prefix[1] + name.slice(prefix[0].length) : name;
}
