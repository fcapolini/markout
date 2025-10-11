import { DIRECTIVE_TAG_PREFIX } from "../html/dom";

export const IN_VALUE_ATTR_PREFIX = ':';
export const OUT_OBJ_ID_ATTR = 'data-domaze';
export const ID_RE = /^_?[a-zA-Z0-9]\w*$/;
export const TEST_ATTR = '__TEST_';
export const TEST_CLOSED_ATTR = TEST_ATTR + 'CLOSED_SCOPE';
export const DEF_SCOPE_NAMES: any = {
  'HTML': 'page',
  'HEAD': 'head',
  'BODY': 'body',
}
export const CLASS_ATTR_PREFIX = 'class$';
export const STYLE_ATTR_PREFIX = 'style$';
export const EVENT_ATTR_PREFIX = 'event$';
export const SYS_ATTR_PREFIX = '';
export const NAME_ATTR = SYS_ATTR_PREFIX + 'name';
export const FOREACH_ATTR = SYS_ATTR_PREFIX + 'foreach';
export const DATA_ATTR = SYS_ATTR_PREFIX + 'data';
export const DEFINE_DIRECTIVE = DIRECTIVE_TAG_PREFIX + 'DEFINE';
export const DEFINE_TAG_ATTR = 'tag';
export const DEFINE_TAG_RE = /^[a-zA-Z]\w*-[-\w]*?\w$/;
export const DEFINE_EXTENDS_ATTR = 'extends';
export const DEFINE_EXTENDS_RE = /^[a-zA-Z]\w*?[-\w]*$/;
