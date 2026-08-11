import { Preprocessor } from "../html/preprocessor";
import { Page } from "./ir/Page";
import { stage1load } from "./stages/stage1-load";
import { stage2validate } from "./stages/stage2-validate";
import { stage3qualify } from "./stages/stage3-qualify";
import { stage4resolve } from "./stages/stage4-resolve";
import { stage5comptime } from "./stages/stage5-comptime";
import { stage6treeshake } from "./stages/stage6-treeshake";
import { DEFAULT_RUNTIME_SRC, stage7generate } from "./stages/stage7-generate";

export interface CompilerProps {
  docroot: string;
  /** `src` for the bootstrap `<script>` that loads the runtime; see stage7-generate.ts */
  runtimeSrc?: string;
}

export class Compiler {
  preprocessor: Preprocessor;
  runtimeSrc: string;

  constructor(options: CompilerProps) {
    this.preprocessor = new Preprocessor(options.docroot);
    this.runtimeSrc = options.runtimeSrc ?? DEFAULT_RUNTIME_SRC;
  }

  async compile(pathname: string): Promise<Page> {
    const page = new Page(await this.preprocessor.load(pathname));
    page.errors = page.source.errors;
    page.errors.length || stage1load(page);
    page.errors.length || stage2validate(page);
    page.errors.length || stage3qualify(page);
    page.errors.length || stage4resolve(page);
    page.errors.length || stage5comptime(page);
    page.errors.length || stage6treeshake(page);
    page.errors.length || stage7generate(page, this.runtimeSrc);
    return page;
  }
}
