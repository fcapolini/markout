import { CoreContext } from './core-context';
import { CoreScope } from './core-scope';
import { CoreValueProps } from './core-value';

//FIXME: server-side timer stuff should be no-ops
export class CoreGlobal extends CoreScope {
  constructor(
    context: CoreContext,
    additionalValues?: { [key: string | symbol]: CoreValueProps<any> }
  ) {
    super(
      {
        id: '-',
        name: 'window',
        values: additionalValues ?? {},
      },
      context
    );
  }
}
