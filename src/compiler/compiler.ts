import * as acorn from 'acorn';
import { Source } from '../html/parser';
import { Preprocessor } from '../html/preprocessor';
import { SourceLocation } from '../html/server-dom';
import { BaseGlobal } from '../runtime/base/base-global';
import { comptime } from './comptime';
import { generate } from './generator';
import { load } from './loader';
import { qualify } from './qualifier';
import { resolve } from './resolver';
import { treeshake } from './treeshaker';
import { validate } from './validator';

export interface CompilerPage {
  source: Source;
  root?: CompilerScope;
  code?: acorn.ExpressionStatement;
}

export type CompilerScopeType = 'foreach' | 'define' | 'instance' | undefined;

export interface CompilerScope {
  id: number;
  name?: CompilerProp;
  type: CompilerScopeType;
  defines?: string;
  xtends?: CompilerScope | string;
  slotmap?: { [key: string]: number };
  uses?: string;
  closed?: boolean;
  comptime?: boolean; //TODO
  values?: { [key: string]: CompilerValue };
  parent?: CompilerScope;
  children: CompilerScope[];
  loc: SourceLocation;
}

export interface CompilerValue {
  val: string | acorn.Expression | null;
  keyLoc: SourceLocation;
  valLoc?: SourceLocation;
  refs?: Set<string>;
}

export interface CompilerProp extends CompilerValue {
  val: string;
}

export interface CompilerProps {
  docroot: string;
  global: BaseGlobal;
}

export class Compiler {
  props: CompilerProps;
  preprocessor: Preprocessor;

  constructor(props: CompilerProps) {
    this.props = props;
    this.preprocessor = new Preprocessor(props.docroot);
  }

  async compile(fname: string): Promise<CompilerPage> {
    const page: CompilerPage = {
      source: await this.preprocessor.load(fname),
    };
    return Compiler.compilePage(page, this.props.global);
  }

  static compilePage(page: CompilerPage, global: BaseGlobal): CompilerPage {
    if (page.source.errors.length) {
      return page;
    }
    page.root = load(page.source);
    if (page.source.errors.length) {
      return page;
    }
    if (
      !validate(page.source, page.root) ||
      !qualify(page.source, page.root, global) ||
      !resolve(page.source, page.root, global) ||
      !comptime(page.source, page.root)
    ) {
      return page;
    }
    treeshake(page.root);
    page.code = generate(page.root);
    return page;
  }
}
