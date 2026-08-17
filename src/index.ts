#!/usr/bin/env node

import path from 'path';
import { readFileSync } from 'fs';
import { Server } from './server';
import { build, type BuildResult } from './server/build';
import { formatRuntimeError } from './runtime/core/core-context';

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
    .argument('<pathname>', 'path to directory containing HTML files (docroot)')
    .argument('<outdir>', 'where to write the compiled pages and assets')
    .option(
      '-p, --page <pathname>',
      'compile only this page, docroot-relative; repeatable',
      (value: string, previous: string[]) => previous.concat(value),
      [] as string[]
    )
    .action(async (pathname: string, outdir: string, options: { page: string[] }) => {
      const docroot = path.resolve(process.cwd(), pathname);
      const target = path.resolve(process.cwd(), outdir);
      try {
        report(await build({ docroot, outdir: target, pages: options.page }));
      } catch (err) {
        // a refusal about the arguments themselves (nested directories, no
        // runtime bundle): nothing was written, and the message says why
        console.error(err instanceof Error ? err.message : `${err}`);
        process.exitCode = 1;
      }
    });

  program
    .argument('<pathname>', 'path to directory containing HTML files (docroot)')
    .option('-p, --port <number>', 'port number, default: 3000')
    .option('-d, --dev', 'dev mode: show runtime expression errors in the page')
    .option('-c, --compress', 'compress responses (gzip/deflate) when the client accepts it')
    .action((pathname, options) => {
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

  if (process.argv.length === 2) {
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
 * A RENDER error does not fail the build, matching what the server does with
 * the same failure: the page is written, and the value that threw is a hole in
 * it rather than a reason to have no page at all.
 */
function report(result: BuildResult) {
  result.runtimeErrors.forEach(({ pathname, error }) =>
    console.warn(`${pathname} ${formatRuntimeError(error)}`)
  );

  if (result.errors.length) {
    result.errors.forEach(({ pathname, error }) => {
      const loc = error.loc;
      const where = loc
        ? `${loc.source ?? pathname}:${loc.start.line}:${loc.start.column + 1}`
        : pathname;
      console.error(`${where}: ${error.msg}`);
    });
    const pages = new Set(result.errors.map(e => e.pathname));
    console.error(
      `\n${result.errors.length} error(s) in ${pages.size} page(s); ` +
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
    : ', no assets copied (restricted to named pages)';
  console.log(
    `${result.pages.length} page(s)${assets}, runtime at ${result.runtime}`
  );
}

void main();
