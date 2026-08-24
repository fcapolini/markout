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

/**
 * The standard kit, which every page has without asking.
 *
 * `@markout-lang/std-kit` is the system parts of a page -- data sources, and
 * the outside world -- written with the language rather than built into it.
 * "Written with the language" is how it is BUILT; part of the language is
 * what it IS, and a part of the language you have to import is ceremony HTML
 * asks for nowhere else. So a page gets it the way it gets `<video>`: it is
 * there.
 *
 * The decision lives here rather than in the preprocessor, which processes
 * HTML and has no business knowing which package is special. It is handed a
 * list of pathnames to splice and asks nothing about them.
 *
 * Three rules make it a convenience rather than a claim on the namespace:
 *
 * - **Spliced first**, ahead of anything the page wrote. `page.customTags`
 *   is filled in document order, so a page's own `<:define>` -- or a kit it
 *   imports after -- wins the name back with nothing to say about it.
 * - **The explicit import still works.** `<:import>` is once-only by
 *   resolved pathname, so saying it out loud gets it once, not twice.
 * - **Absent is absent.** Only a MOUNTED kit is spliced, so a docroot
 *   without it compiles exactly as it did.
 *
 * Through the kit's mounted root rather than through `/npm/`: both land on
 * the same pathname, which is what lets the once-rule dedupe them, but this
 * table is the one the caller handed us and has already validated, while
 * `/npm/` resolves a second way -- walking `node_modules` up from the
 * docroot -- which a host is free to have arranged differently, and hosts
 * do.
 *
 * A millisecond a page, measured on a trivial one: 0.2ms to 1.3ms, against
 * 17ms for a page that imports the bootstrap kit. Nothing reaches the
 * output, since treeshaking drops what the page never mentions.
 */
export const STD_KIT_PACKAGE = '@markout-lang/std-kit';
/** what a kit calls its everything file, by convention */
export const STD_KIT_ENTRY = 'all.htm';

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
  /**
   * Append a `<template>` naming every class a `:class-` toggle can put on
   * the page, for a CSS generator that reads the output -- see
   * stage7-generate's injectClassManifest and docs/design/tailwind-support.md.
   *
   * Off by default, because a project not generating its stylesheet from the
   * markup pays nothing for a page that says what it already shows.
   */
  classManifest?: boolean;
  /**
   * Say what built the page: `<meta name="generator" content="Markout 0.4.0">`,
   * appended to `<head>` unless the page already names a generator.
   *
   * On by default, and off is a supported answer rather than a thing to
   * strip afterwards. Someone hardening a deployment would otherwise be
   * post-processing the HTML to remove it, which is the arrangement every
   * generator that made this unconditional has left its users with. It
   * carries no version, deliberately -- see stage7-generate's
   * injectGenerator.
   */
  generator?: boolean;
}

export class Compiler {
  preprocessor: Preprocessor;
  runtimeSrc: string;
  dev: boolean;
  treeshake: boolean;
  classManifest: boolean;
  generator: boolean;
  serverGlobals: ReadonlySet<string>;

  constructor(options: CompilerProps) {
    const std = options.kits?.find(kit => kit.name === STD_KIT_PACKAGE);
    this.preprocessor = new Preprocessor(
      options.docroot,
      options.kits,
      options.readFile,
      std ? [`${std.root}/${STD_KIT_ENTRY}`] : []
    );
    this.runtimeSrc = options.runtimeSrc ?? DEFAULT_RUNTIME_SRC;
    this.dev = options.dev ?? false;
    this.treeshake = options.treeshake ?? true;
    this.classManifest = options.classManifest ?? false;
    this.generator = options.generator ?? true;
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
    // `hasErrors`, not `errors.length`: a warning is something to say about a
    // page that builds, so it must not stop the page being built
    page.hasErrors || stage1load(page);
    page.hasErrors || stage2validate(page);
    page.hasErrors || stage3qualify(page);
    page.hasErrors || stage4resolve(page);
    page.hasErrors || stage5comptime(page);
    page.hasErrors || !this.treeshake || stage6treeshake(page);
    page.hasErrors ||
      stage7generate(page, this.runtimeSrc, this.dev, this.classManifest, this.generator);
    return page;
  }
}
