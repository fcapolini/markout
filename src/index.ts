#!/usr/bin/env node

import path from 'path';
import { readFileSync } from 'fs';
import { Server } from './server';

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
    .argument('<pathname>', 'path to directory containing HTML files (docroot)')
    .option('-p, --port <number>', 'port number, default: 3000')
    .action((pathname, options) => {
      console.log(`Starting server for ${pathname}...`);
      const docroot = path.normalize(path.join(process.cwd(), pathname));
      const port = Number.parseInt(options.port) || 3000;
      new Server({ docroot, port }).start();
    });

  if (process.argv.length === 2) {
    program.help();
  }

  program.parse();
}

void main();
