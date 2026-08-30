#!/usr/bin/env node

import path from 'path';
import { readFileSync, statSync } from 'fs';
import { Server } from './server';

import {
  build,
  CLASSES_MANIFEST_FILE,
  formatRuntimeError,
  type BuildResult,
} from '@markout-lang/core';
import { addKits, restoreKits, type InstallReport } from './kits';
import { DEFAULT_DOCROOT, DEFAULT_OUTDIR } from './defaults';

function hasDefaultDocroot(): boolean {
  try {
    return statSync(path.resolve(process.cwd(), DEFAULT_DOCROOT)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * What an install did, and whether the process should be unhappy about it.
 *
 * A partial failure still exits non-zero: `markout restore` in CI that
 * fetched three kits of four and said so cheerfully would produce a build
 * missing a kit, which is the silent failure the manifest exists to end.
 */
function reportInstall(report: InstallReport) {
  report.installed.forEach(line => console.log(`markout: installed ${line}`));
  report.unchanged.forEach(line => console.log(`markout: ${line} already installed`));
  report.errors.forEach(line => console.error(`markout: ${line}`));
  if (report.manifest && report.pinned) {
    console.log(`markout: pinned in ${report.manifest}`);
  }
  if (report.errors.length) {
    process.exitCode = 1;
  }
}

async function main() {
  const { Command } = await import('commander');
  const program = new Command();

  // Read version from package.json -- unless something bundled this file
  // somewhere else, where `../package.json` is a stranger's. The VS Code
  // extension bundles it as a sidecar, and `define` replaces the expression
  // below with a literal at that point; everywhere else it is an unset
  // environment variable and the file is read as before.
  const packageJson = {
    version:
      process.env.MARKOUT_CLI_VERSION ||
      (JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
        .version as string),
  };

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
  // docs/concepts/isomorphism.md -- this is the mode for a project whose pages
  // are served by something that isn't Node.
  //
  // A subcommand rather than a flag on the default one, which is also what
  // frees `-p`: `--port` belongs to serving and does not exist here, so the
  // letter means the obvious thing in each place it appears.
  // Two commands, because they are two different operations and only one of
  // them is a compile.
  //
  // `build` compiles: `:` directives become a props object beside a runtime
  // link, and every value is resolved in the browser. That is what a client-
  // side framework's build does, and it asks nothing of the world around it.
  //
  // `prerender` compiles and then RUNS each page, writing resolved values into
  // the markup so a visitor gets finished HTML. That is worth having and it is
  // worth being asked for: a render performs a page's `:server-` fetches, so
  // it needs whatever answers them reachable from the build machine, and it
  // freezes that moment's answer into the artifact. A compile step that
  // quietly required the backend to be up would be the surprising one.
  //
  // Subcommands rather than a flag on the default one, which is also what
  // frees `-p`: `--port` belongs to serving and does not exist here, so the
  // letter means the obvious thing in each place it appears.
  for (const mode of [
    {
      name: 'build',
      description:
        'compile a docroot ahead of time into static files; values resolve ' +
        'in the browser, as they would in any client-side build',
      prerender: false,
    },
    {
      name: 'prerender',
      description:
        'compile a docroot AND render each page, so the output carries its ' +
        'content; runs `:server-` fetches at build time',
      prerender: true,
    },
  ]) {
    const command = program
      .command(mode.name)
      .description(mode.description)
      .argument('[pathname]', `path to the docroot; defaults to ./${DEFAULT_DOCROOT}`)
      .argument('[outdir]', `where to write; defaults to a ./${DEFAULT_OUTDIR} beside the docroot`)
      .option(
        '-p, --page <pathname>',
        'compile only this page, docroot-relative; repeatable',
        (value: string, previous: string[]) => previous.concat(value),
        [] as string[]
      );

    // Only on `prerender`, because it only means anything during a render.
    // What `$origin` is while the pages are rendered, and so what a page's own
    // `/data.json` resolves against. A build has no request to take one from,
    // and a page whose data is files in its docroot is renderable as soon as
    // anything is serving them -- `markout <docroot>` in another terminal will
    // do. Without this such a page cannot be PRERENDERED at all: its
    // datasources refuse a relative url with nothing to resolve it against.
    // It can still be built.
    if (mode.prerender) {
      command.option(
        '-o, --origin <url>',
        'the origin the pages are rendered for, e.g. http://127.0.0.1:3000; ' +
          'relative `:server-` fetches resolve against it'
      );
    }

    // Both of these exist for CSS that is GENERATED by reading the markup --
    // Tailwind and its kind. A `:class-` toggle spells its utility in the
    // attribute name, where no scanner looks, so the class is applied and no
    // rule was ever generated for it. See docs/design/tailwind-support.md.
    //
    // Two flags because there are two projects. One deploys this output and
    // wants the names to travel with the pages; the other serves its sources
    // from Node and wants a scan target it can throw away.
    command
      .option(
        '--class-manifest',
        'add a <template> to each page naming the classes its `:class-` ' +
          'toggles can apply, for a CSS generator that reads the output'
      )
      .option(
        '--classes-only',
        `write only ${CLASSES_MANIFEST_FILE} -- the same names, merged, with ` +
          'no pages, assets or runtime; the scan target for a served docroot'
      )
      // Opt-in, and it stays opt-in: what a build writes derives from what is
      // INSTALLED rather than from what a page imported, so that dev and the
      // deliverable cannot disagree about whether a kit's resource exists.
      // This bends that, on evidence read from the written pages, for the
      // person who knows theirs do not build URLs at runtime -- a stronger
      // thing to know under `build`, where a url a value would have produced
      // is not in the text at all.
      .option(
        '--prune-kits',
        "drop an installed kit's files when no written page mentions its root"
      )
      // negated, so the default reads as what it is: pages say what built
      // them unless a deployment would rather they did not
      .option(
        '--no-generator',
        'omit the <meta name="generator"> naming Markout and its version'
      )
      .action(async (pathname: string | undefined, outdir: string | undefined, options: { page: string[]; origin?: string; classManifest?: boolean; classesOnly?: boolean; pruneKits?: boolean; generator?: boolean }) => {
        const docroot = path.resolve(process.cwd(), pathname ?? DEFAULT_DOCROOT);
        // beside the docroot rather than inside it: these commands refuse an
        // output directory under the docroot, because the next run would
        // compile its own output. A sibling is the only default that cannot
        // be refused
        const target = outdir
          ? path.resolve(process.cwd(), outdir)
          : path.join(path.dirname(docroot), DEFAULT_OUTDIR);
        let origin: string | undefined;
        if (options.origin) {
          // refused here rather than inside every render: a typo would
          // otherwise surface once per datasource, as a fetch failure that
          // names the datasource instead of the flag
          try {
            origin = new URL(options.origin).origin;
          } catch {
            console.error(
              `markout: --origin "${options.origin}" is not an absolute URL ` +
                `(it needs a scheme, e.g. http://127.0.0.1:3000)`
            );
            process.exitCode = 1;
            return;
          }
        }
        try {
          report(
            await build({
              docroot,
              outdir: target,
              // only when we chose it: see BuildProps.gitignore
              gitignore: !outdir,
              pages: options.page,
              origin,
              prerender: mode.prerender,
              classManifest: options.classManifest,
              classesOnly: options.classesOnly,
              pruneKits: options.pruneKits,
              generator: options.generator,
            }),
            options.page.length > 0,
            !!options.classesOnly
          );
        } catch (err) {
          // a refusal about the arguments themselves (nested directories, no
          // runtime bundle): nothing was written, and the message says why
          console.error(err instanceof Error ? err.message : `${err}`);
          process.exitCode = 1;
        }
      });
  }

  // Installing a kit WITHOUT npm, which is the only reason these exist.
  //
  // Somebody who has npm should use it: `npm i @markout-lang/bootstrap-kit`
  // puts the kit somewhere discovery already looks, with a lockfile and a
  // resolver behind it, and none of that is worth reimplementing. These two
  // serve the audience the language is pitched at, who have no npm on their
  // PATH and often none on the machine -- and CI, which needs to fill a
  // `.markout/kits/` that a clone deliberately does not carry. See
  // docs/design/without-node.md and docs/reference/vscode-extension-sidebar.md.
  // The same code the extension's sidebar runs, through `./kits`.
  program
    .command('add')
    .description(
      'fetch a kit into .markout/kits/ and pin it in .markout/kits.json, ' +
        'with no npm involved; if you have npm, prefer `npm i <kit>`'
    )
    .argument('<kit...>', 'package name, or name@version; defaults to the latest')
    .option('--docroot <pathname>', `path to the docroot; defaults to ./${DEFAULT_DOCROOT}`)
    .action(async (specs: string[], options: { docroot?: string }) => {
      const docroot = path.resolve(process.cwd(), options.docroot ?? DEFAULT_DOCROOT);
      reportInstall(await addKits(docroot, specs));
    });

  program
    .command('restore')
    .description(
      'fetch every kit .markout/kits.json pins; the command a fresh clone ' +
        'and a CI job run, since kits/ is not committed by default'
    )
    .option('--docroot <pathname>', `path to the docroot; defaults to ./${DEFAULT_DOCROOT}`)
    .action(async (options: { docroot?: string }) => {
      const docroot = path.resolve(process.cwd(), options.docroot ?? DEFAULT_DOCROOT);
      reportInstall(await restoreKits(docroot));
    });

  program
    .argument('[pathname]', `path to the docroot; defaults to ./${DEFAULT_DOCROOT}`)
    .option('-p, --port <number>', 'port number, default: 3000')
    .option('-d, --dev', 'dev mode: show runtime expression errors in the page')
    // The third delivery mode, served rather than written out. A project
    // that ships `markout build` output and previews a SERVED render is
    // looking at a page it will not deploy -- and this is also what lets a
    // preview run no page expression, and so no kit's, in this process.
    .option(
      '--client',
      'serve pages as `markout build` writes them: no server-side render, ' +
        'so every value resolves in the browser'
    )
    .option(
      '-c, --compress',
      'compress responses (gzip/deflate) when the client accepts it; '
        + 'redundant behind a proxy or CDN that already does'
    )
    .option(
      '--no-generator',
      'omit the <meta name="generator"> naming Markout and its version'
    )
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
        client: !!options.client,
        compress: !!options.compress,
        generator: options.generator,
      }).start();
    });

  // Bare `markout` serves ./markout when it is there, and otherwise says
  // what it would have needed. Help rather than an error: somebody typing
  // the bare name is asking what this is, and the answer is the usage.
  if (process.argv.length === 2 && !hasDefaultDocroot()) {
    program.help();
  }

  // `from: 'node'` said rather than left to be guessed. Commander's
  // auto-detection reads `process.versions.electron` and, finding it, keeps
  // argv[1] as a positional -- which is right for a packaged Electron app
  // and wrong for this, whose argv is always `[node, script, ...args]`.
  //
  // It matters because of who spawns this. The editor's sidebar runs the
  // bundled copy with `process.execPath`, and in an extension host that is
  // the Electron binary, so the child reports itself as Electron and the
  // docroot became "too many arguments". See packages/vscode/src/preview.ts.
  program.parse(process.argv, { from: 'node' });
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
function report(result: BuildResult, restricted = false, classesOnly = false) {
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

  // Not a refusal: two copies of one kit are resolved by taking the nearer,
  // which is the rule rather than a failure of it. Worth a line all the same
  // when the two are different versions, since that is a build quietly
  // deciding which of them a page was compiled against
  result.kitShadowed.forEach(msg => console.warn(`markout: ${msg}`));

  result.runtimeErrors.forEach(({ pathname, error }) =>
    console.warn(`${pathname} ${formatRuntimeError(error)}`)
  );

  // said, and not counted against the build: these name pages that compiled
  result.warnings.forEach(({ pathname, error }) => {
    const loc = error.loc;
    const where = loc
      ? `${loc.source ?? pathname}:${loc.start.line}:${loc.start.column + 1}`
      : pathname;
    console.warn(`${where}: warning: ${error.msg}`);
  });

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

  // A manifest-only run wrote one file and no pages, so the ordinary line
  // below would report "0 page(s)" for a run that did exactly what it was
  // asked. Say what it produced instead, and say how many names -- zero is
  // worth noticing, since it means either no page uses a `:class-` toggle or
  // the docroot was not the one intended.
  if (classesOnly) {
    const names = result.classes ?? [];
    console.log(`${names.length} class name(s) -> ${CLASSES_MANIFEST_FILE}`);
    // An empty manifest is the one outcome worth saying more about, because
    // the check it exists to feed -- every name in here has a rule in your
    // stylesheet -- PASSES on an empty list. A docroot with no toggles is a
    // legitimate thing to have, so this is not an error; a docroot that is
    // not the one you meant is the likelier cause, and either way a CI step
    // is about to go green while testing nothing.
    if (!names.length) {
      console.warn(
        `markout: no \`:class-\` toggles found, so ${CLASSES_MANIFEST_FILE} is empty ` +
          `-- a check against it will pass without testing anything`
      );
    }
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
  const manifest = result.classes
    ? `, ${result.classes.length} class name(s) in each page's manifest`
    : '';
  console.log(
    `${result.pages.length} page(s)${assets}, runtime at ${result.runtime}${manifest}`
  );

  // Said rather than silently done. A build shipping less than the one
  // before it is how a missing file becomes a 404 nobody connects to a flag
  // set months ago -- and "pruned nothing" is worth saying too, since it is
  // the answer to "why is this kit still in my output"
  if (result.prunedKits) {
    console.log(
      result.prunedKits.length
        ? `pruned ${result.prunedKits.length} kit(s) no page mentions: ` +
            result.prunedKits.join(' ')
        : 'no kits pruned: every installed one is mentioned by a built page'
    );
  }
}

void main();
