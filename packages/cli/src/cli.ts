#!/usr/bin/env node

import path from 'path';
import { readFileSync, statSync } from 'fs';
import { Server } from './server';
import { build, type BuildResult } from './server/build';
import { formatRuntimeError } from '@markout-dev/core';

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

function hasDefaultDocroot(): boolean {
  try {
    return statSync(path.resolve(process.cwd(), DEFAULT_DOCROOT)).isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  const { Command } = await import('commander');
  const program = new Command();

  // Read version from package.json
  const packageJson = JSON.parse(
    readFileSync(path.join(__dirname, '../package.json'), 'utf8')
  );

  program
    .name('markout')
    .description(`Markout v${packageJson.version} - https://github.com/fcapolini/markout`)
    .version(packageJson.version)
    .helpOption('-h, --help', 'display help for command')
    // Without this, an option is matched against the PROGRAM wherever it
    // appears -- so `build src out -p index` handed `-p` to `--port` and the
    // build saw no page at all. Positional mode is what actually gives each
    // command its own options: the program's come before the command name,
    // the command's after it, and `-p` can mean the obvious thing in both.
    .enablePositionalOptions();

  // Ahead-of-time delivery: one build, then plain files on any host. See
  // docs/concepts/rendering.md -- this is the mode for a project whose pages
  // are served by something that isn't Node.
  //
  // A subcommand rather than a flag on the default one, which is also what
  // frees `-p`: `--port` belongs to serving and does not exist here, so the
  // letter means the obvious thing in each place it appears.
  program
    .command('build')
    .description('compile a docroot ahead of time into static files')
    .argument('[pathname]', `path to the docroot; defaults to ./${DEFAULT_DOCROOT}`)
    .argument('[outdir]', `where to write; defaults to a ./${DEFAULT_OUTDIR} beside the docroot`)
    .option(
      '-p, --page <pathname>',
      'compile only this page, docroot-relative; repeatable',
      (value: string, previous: string[]) => previous.concat(value),
      [] as string[]
    )
    .action(async (pathname: string | undefined, outdir: string | undefined, options: { page: string[] }) => {
      const docroot = path.resolve(process.cwd(), pathname ?? DEFAULT_DOCROOT);
      // beside the docroot rather than inside it: `build` refuses an output
      // directory under the docroot, because the next run would compile its
      // own output. A sibling is the only default that cannot be refused
      const target = outdir
        ? path.resolve(process.cwd(), outdir)
        : path.join(path.dirname(docroot), DEFAULT_OUTDIR);
      try {
        report(
          await build({ docroot, outdir: target, pages: options.page }),
          options.page.length > 0
        );
      } catch (err) {
        // a refusal about the arguments themselves (nested directories, no
        // runtime bundle): nothing was written, and the message says why
        console.error(err instanceof Error ? err.message : `${err}`);
        process.exitCode = 1;
      }
    });

  program
    .argument('[pathname]', `path to the docroot; defaults to ./${DEFAULT_DOCROOT}`)
    .option('-p, --port <number>', 'port number, default: 3000')
    .option('-d, --dev', 'dev mode: show runtime expression errors in the page')
    .option('-c, --compress', 'compress responses (gzip/deflate) when the client accepts it')
    .action((pathname, options) => {
      pathname = pathname ?? DEFAULT_DOCROOT;
      console.log(`Starting server for ${pathname}...`);
      // resolve, not join: an ABSOLUTE docroot was being appended to the
      // working directory, so `markout /srv/site` watched and served
      // `$PWD/srv/site` and answered 404 for everything in it. Same call
      // `build` makes, which is how the two came to disagree
      const docroot = path.resolve(process.cwd(), pathname);
      const port = Number.parseInt(options.port) || 3000;
      new Server({
        docroot,
        port,
        dev: !!options.dev,
        compress: !!options.compress,
      }).start();
    });

  // Bare `markout` serves ./markout when it is there, and otherwise says
  // what it would have needed. Help rather than an error: somebody typing
  // the bare name is asking what this is, and the answer is the usage.
  if (process.argv.length === 2 && !hasDefaultDocroot()) {
    program.help();
  }

  program.parse();
}

/**
 * What a build says when it is done, and what it exits with.
 *
 * A compile error exits non-zero, because this is the half of the language's
 * checking that a static host can never do later: a page served from Node
 * reports its errors to whoever asks for it, while a built one is read by
 * somebody who cannot see this console. So CI has to be able to fail here,
 * which means a status code and one line per error in the shape editors and
 * log scrapers already understand.
 *
 * An ORDINARY render error does not fail the build, matching what the server
 * does with the same failure: the browser re-derives that value, so what threw
 * here is a hole that fills itself rather than a reason to have no page.
 *
 * A `:server-` value failing does fail it. That one crosses frozen, with a
 * result and no expression, so nothing re-runs it -- the page would be shipped
 * permanently without whatever it was for. It is the failure this mode invites,
 * since there is no request here to supply what such a value usually reads.
 */
function report(result: BuildResult, restricted = false) {
  // First, and on their own: a refused kit is decided before any page is
  // read, so there is nothing else to report and nothing was written. Every
  // one of these names two things that cannot both have the same URL, so the
  // fix is a rename rather than anything about the pages.
  if (result.kitErrors.length) {
    result.kitErrors.forEach(msg => console.error(`markout: ${msg}`));
    console.error(`\n${result.kitErrors.length} kit(s) refused; nothing written`);
    process.exitCode = 1;
    return;
  }

  result.runtimeErrors.forEach(({ pathname, error }) =>
    console.warn(`${pathname} ${formatRuntimeError(error)}`)
  );

  if (result.errors.length || result.serverErrors.length) {
    result.errors.forEach(({ pathname, error }) => {
      const loc = error.loc;
      const where = loc
        ? `${loc.source ?? pathname}:${loc.start.line}:${loc.start.column + 1}`
        : pathname;
      console.error(`${where}: ${error.msg}`);
    });
    result.serverErrors.forEach(({ pathname, error }) =>
      console.error(`${pathname} ${formatRuntimeError(error)}`)
    );
    const failed = [...result.errors, ...result.serverErrors];
    const pages = new Set(failed.map(e => e.pathname));
    console.error(
      `\n${failed.length} error(s) in ${pages.size} page(s); ` +
        `${result.pages.length} page(s) written`
    );
    process.exitCode = 1;
    return;
  }

  // the extensions, not just the count: everything that is not a page is
  // copied across, which is what the server already serves from the same
  // directory -- and a docroot with source files in it (a `.ts`, a `.php`)
  // would publish them. Naming the kinds is what gives someone the chance to
  // notice before the output is uploaded somewhere
  const kinds = [...new Set(result.assets.map(a => path.extname(a) || '(none)'))].sort();
  const assets = result.assets.length
    ? `, ${result.assets.length} asset(s) [${kinds.join(' ')}]`
    : restricted
      ? ', no assets copied (restricted to named pages)'
      : ', no assets';
  console.log(
    `${result.pages.length} page(s)${assets}, runtime at ${result.runtime}`
  );
}

void main();
