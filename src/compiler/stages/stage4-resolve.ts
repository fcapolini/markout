import { PageError } from '../../html/parser';
import type { Page } from '../ir/Page';

const RT_PARENT_VALUE_KEY = '$parent';

/**
 * Stage 4: Resolve value references at compile time.
 *
 */

export function stage4resolve(page: Page) {
  //TODO
  return page;
}

function addError(page: Page, msg: string, loc?: any) {
  page.errors.push(new PageError('error', msg, loc));
}
