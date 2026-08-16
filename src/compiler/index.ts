import { Preprocessor } from "../html/preprocessor";
import { Page } from "./ir/Page";
import { stage1load } from "./stages/stage1-load";
import { stage2validate } from "./stages/stage2-validate";
import { stage3qualify } from "./stages/stage3-qualify";
import { stage4resolve } from "./stages/stage4-resolve";
import { stage5comptime } from "./stages/stage5-comptime";
import { stage6treeshake } from "./stages/stage6-treeshake";
import { DEFAULT_RUNTIME_SRC, stage7generate } from "./stages/stage7-generate";
import { GLOBAL_NAMES } from "./stages/stage4-resolve";

export interface CompilerProps {
  docroot: string;
  /** `src` for the bootstrap `<script>` that loads the runtime; see stage7-generate.ts */
  runtimeSrc?: string;
  /** emit the dev flag, so the browser runtime surfaces errors in the page */
  dev?: boolean;
  /**
   * Names the host supplies to the server at runtime -- see Page.serverGlobals.
   * Names only; the compiler never sees, and never needs, the objects.
   */
  serverGlobals?: Iterable<string>;
}

export class Compiler {
  preprocessor: Preprocessor;
  runtimeSrc: string;
  dev: boolean;
  serverGlobals: ReadonlySet<string>;

  constructor(options: CompilerProps) {
    this.preprocessor = new Preprocessor(options.docroot);
    this.runtimeSrc = options.runtimeSrc ?? DEFAULT_RUNTIME_SRC;
    this.dev = options.dev ?? false;
    this.serverGlobals = new Set(options.serverGlobals ?? []);
    // a name that is already the language's would be unreachable behind it,
    // and the page author would have no way to tell which one they got
    for (const name of this.serverGlobals) {
      if (GLOBAL_NAMES.has(name)) {
        throw new Error(
          `markout: cannot supply "${name}" as a server global: ` +
            `it is already one of the language's own`
        );
      }
    }
  }

  async compile(pathname: string): Promise<Page> {
    const page = new Page(await this.preprocessor.load(pathname));
    page.serverGlobals = this.serverGlobals;
    page.errors = page.source.errors;
    page.errors.length || stage1load(page);
    page.errors.length || stage2validate(page);
    page.errors.length || stage3qualify(page);
    page.errors.length || stage4resolve(page);
    page.errors.length || stage5comptime(page);
    page.errors.length || stage6treeshake(page);
    page.errors.length || stage7generate(page, this.runtimeSrc, this.dev);
    return page;
  }
}
