/**
 * The names the command line falls back to, in a module of their own.
 *
 * Apart from `cli.ts` because that file RUNS the command as a side effect of
 * being loaded -- it ends in `void main()`, which is what makes it a bin. A
 * barrel re-exporting these from there would parse `process.argv` the moment
 * an application imported `Server`, and serve or build whatever the host
 * program's own flags happened to look like.
 */
/**
 * The directory served when none is named.
 *
 * A convention rather than a rule, and a load-bearing one: it is what lets a
 * project use markout with nothing installed and nothing configured -- write
 * the pages, run `markout`, done. The editor support leans on the same name
 * to find a docroot when there is no package.json to find one by, so the two
 * agree about where a page's `/lib.htm` resolves. See
 * docs/design/editor-support.md.
 *
 * Distinctive on purpose. `public`, `www` and `static` belong to every
 * static-site tool there is, and a tool claiming one of those would be
 * guessing at somebody else's layout.
 */
export const DEFAULT_DOCROOT = 'markout';

/**
 * Where a build writes when no output directory is named: a `dist` BESIDE
 * the docroot, not inside it.
 *
 * Beside, because `build` refuses an outdir under the docroot -- the next run
 * would compile its own output -- so a sibling is the only default that
 * cannot be refused. With the docroot default that makes the whole
 * ahead-of-time mode `markout build`, with a layout the CLI and the editor
 * both already understand:
 *
 *     markout/     the pages
 *     dist/        what to deploy
 */
export const DEFAULT_OUTDIR = 'dist';
