import { Preprocessor, type ReadFile } from "../html/preprocessor";
import type { Kit } from "../kits";
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
  /**
   * Installed kits, each mounted at the logical root it declares. Absent
   * means none, which is what every caller wanted before kits existed.
   *
   * Passed IN rather than discovered here, so that the server and the build
   * scan once at startup and compile every page against the same table --
   * see docs/design/npm-kits.md on why both derive it from what is installed.
   */
  kits?: Kit[];
  /**
   * How a file's text is read, given a path the resolver already approved.
   * Defaults to the disk. An editor passes its own, so a page is compiled as
   * it is being typed rather than as it was last saved -- see ReadFile.
   */
  readFile?: ReadFile;
  /** `src` for the bootstrap `<script>` that loads the runtime; see stage7-generate.ts */
  runtimeSrc?: string;
  /** emit the dev flag, so the browser runtime surfaces errors in the page */
  dev?: boolean;
  /**
   * Drop definitions no page element uses. On by default, because a page
   * should not ship a component it never mentions.
   *
   * An editor turns it off. What it needs is what the page COULD use -- the
   * list a completion offers is the whole imported kit, not the handful of
   * tags already typed -- and a definition that has just been imported and
   * not yet used is exactly the one somebody is about to ask about.
   */
  treeshake?: boolean;
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
  treeshake: boolean;
  serverGlobals: ReadonlySet<string>;

  constructor(options: CompilerProps) {
    this.preprocessor = new Preprocessor(options.docroot, options.kits, options.readFile);
    this.runtimeSrc = options.runtimeSrc ?? DEFAULT_RUNTIME_SRC;
    this.dev = options.dev ?? false;
    this.treeshake = options.treeshake ?? true;
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
    page.errors.length || !this.treeshake || stage6treeshake(page);
    page.errors.length || stage7generate(page, this.runtimeSrc, this.dev);
    return page;
  }
}
