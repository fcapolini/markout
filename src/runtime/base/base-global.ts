import { set } from 'pm2';
import { BaseContext } from './base-context';
import { BaseScope } from './base-scope';
import { BaseValueProps } from './base-value';

export class BaseGlobal extends BaseScope {
  constructor(
    context: BaseContext,
    additionalValues?: { [key: string | symbol]: BaseValueProps<any> }
  ) {
    super(
      {
        id: '-',
        name: 'window',
        values: {
          console: { val: console },
          setTimeout: { val: setTimeout },
          clearTimeout: { val: clearTimeout },
          setInterval: { val: setInterval },
          clearInterval: { val: clearInterval },
          ...additionalValues,
        },
      },
      context
    );
  }
}
