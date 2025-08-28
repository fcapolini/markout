import { Context } from './context';
import { Scope } from './scope';
import { ValueProps } from './value';

export class Global extends Scope {
  constructor(
    context: Context,
    additionalValues?: { [key: string | symbol]: ValueProps<any> }
  ) {
    super(
      {
        id: '-',
        name: 'window',
        values: {
          console: {
            val: console,
          },
          ...additionalValues,
        },
      },
      context
    );
  }
}
