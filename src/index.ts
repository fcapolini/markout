#!/usr/bin/env node

import { Command } from 'commander';
import path from 'path';
import { readFileSync } from 'fs';
import { Server } from './server/server';

const program = new Command();

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(path.join(__dirname, '../package.json'), 'utf8')
);

program
  .name('markout')
  .description('Markout CLI - https://github.com/fcapolini/markout')
  .version(packageJson.version);

program
  .command('serve')
  .description('serve a Markout project')
  .argument('<pathname>', 'path to directory containing HTML files (docroot)')
  .option('-p, --port <number>', 'port number, default: 3000')
  .option('--client-bin <path>', 'optional path to client.js file')
  .action((pathname, options) => {
    console.log(`Starting server for ${options.clientBin}...`);
    const docroot = path.normalize(path.join(process.cwd(), pathname));
    const port = Number.parseInt(options.port) || 3000;
    new Server({ docroot, port, clientCodePath: options.clientBin }).start();
  });

program.parse();
