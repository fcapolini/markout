import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findManifest, readManifest } from '@markout-lang/core';
// The INSTALLER, through a subpath that carries it and nothing else. Not
// `@markout-lang/cli`, whose main entry is the `markout` command's -- that
// would put a web server and an argument parser in the editor's process for
// no reason. See ../test/dependencies.test.ts, which asserts the difference.
import {
  addKits,
  featuredKits,
  manifestDirFor,
  resolveKit,
  restoreKits,
  searchKits,
  writeManifest,
  type KitListing,
} from '@markout-lang/cli/kits';
import {
  findDocroot,
  isBumpPending,
  managedKitDir,
  pagesUsing,
  pendingBumps,
  projectKits,
  type KitRow,
} from './kits-model';

/**
 * The Markout view: kits with checkboxes, and no terminal anywhere.
 *
 * The audience this is for has no npm on its PATH and frequently none on the
 * machine, so every mechanism here is one that needs neither. Ticking a
 * checkbox fetches a tarball over HTTPS and unpacks it into `.markout/kits/`;
 * the COMPILER resolves it from there, which is what makes the same project
 * buildable by `markout build`, by a teammate's terminal and by CI. See
 * docs/design/without-node.md.
 *
 * The decisions this file makes and the model does not are all VS Code's:
 * what a row looks like, where the badge goes, and which of them is a
 * modal question.
 */

/** declined bumps, per workspace: `{ "@scope/kit": "0.5.0" }` */
const DECLINED = 'markout.declinedBumps';

/** the "Who is this for?" page, copied into the archive by the bundler */
const DOC = 'who-is-this-for.md';

type Row =
  | { kind: 'doc' }
  | { kind: 'error'; message: string }
  | { kind: 'kit'; row: KitRow };

export function registerSidebar(context: vscode.ExtensionContext) {
  const provider = new KitsProvider(context);
  const view = vscode.window.createTreeView('markout.kits', {
    treeDataProvider: provider,
    manageCheckboxStateManually: true,
  });
  provider.attach(view);
  context.subscriptions.push(
    view,
    view.onDidChangeCheckboxState(e => provider.toggled(e.items)),
    vscode.commands.registerCommand('markout.whoIsThisFor', () => whoIsThisFor(context)),
    vscode.commands.registerCommand('markout.refreshKits', () => provider.refresh(true)),
    vscode.commands.registerCommand('markout.searchKits', () => provider.search()),
    vscode.commands.registerCommand('markout.restoreKits', () => provider.restore()),
    vscode.commands.registerCommand('markout.acceptBump', (item: KitItem) =>
      provider.acceptBump(item?.row)
    ),
    vscode.commands.registerCommand('markout.declineBump', (item: KitItem) =>
      provider.declineBump(item?.row)
    ),
    vscode.commands.registerCommand('markout.openKitHomepage', (item: KitItem) =>
      vscode.env.openExternal(
        vscode.Uri.parse(`https://www.npmjs.com/package/${item.row.name}`)
      )
    ),
    // a kit installed or removed from a terminal is the same project change
    // as one ticked here, and the view has no business being the last to know
    vscode.workspace
      .createFileSystemWatcher('**/.markout/kits.json')
      .onDidChange(() => provider.refresh())
  );
  provider.refresh(true);
  return provider;
}

/**
 * The page the "Who is this for?" row opens.
 *
 * Shipped in the archive and previewed from disk, not fetched from github.com.
 * It therefore describes the sidebar the reader HAS rather than the one on
 * main, needs no network -- for an audience whose kit cache exists because
 * they are offline often enough to matter -- and cannot 404 on a doc that has
 * not been merged yet, which is how the github.com version was found out.
 *
 * Written by scripts/bundle.mjs, which also rewrites the page's own relative
 * links to the repository, the rest of `docs/` not travelling with it.
 */
function whoIsThisFor(context: vscode.ExtensionContext) {
  const file = vscode.Uri.file(context.asAbsolutePath(path.join('dist', DOC)));
  // the built-in preview, not the source: this is a page to read, and the
  // markdown is an implementation detail of shipping it
  return vscode.commands.executeCommand('markdown.showPreview', file);
}

class KitItem extends vscode.TreeItem {
  constructor(readonly row: KitRow, pending: boolean) {
    super(shortName(row.name), vscode.TreeItemCollapsibleState.None);
    this.id = row.name;
    this.description = describe(row, pending);
    this.tooltip = tooltip(row, pending);
    this.iconPath = new vscode.ThemeIcon(
      row.missing ? 'warning' : row.installed ? 'package' : 'circle-outline'
    );
    // `kit` always, plus `bump` when there is an offer -- the menu `when`
    // clauses match on the substring, so one row can be both
    this.contextValue = pending ? 'kit bump' : 'kit';
    // Locked ON for an npm-installed kit rather than hidden: it IS installed,
    // somebody looking for it should find it, and the tooltip says who owns
    // it. An unchecked box the user cannot check would be the confusing one.
    this.checkboxState = row.installed
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
  }
}

/** `@markout-lang/bootstrap-kit` reads as `bootstrap-kit` in a narrow view */
function shortName(name: string): string {
  return name.startsWith('@') ? name.substring(name.indexOf('/') + 1) : name;
}

function describe(row: KitRow, pending: boolean): string {
  if (row.missing) {
    return `${row.pinned} — not installed`;
  }
  if (!row.installed) {
    return row.description ?? '';
  }
  const version = pending ? `${row.installed} → ${row.available}` : row.installed;
  return row.managed ? version : `${version} — npm`;
}

function tooltip(row: KitRow, pending: boolean): vscode.MarkdownString {
  const lines = [`**${row.name}**`, ''];
  row.description && lines.push(row.description, '');
  if (row.missing) {
    lines.push(
      `Pinned to \`${row.pinned}\` in \`.markout/kits.json\` and not installed.`,
      '',
      'Tick it, or run **Restore kits**, to fetch it. Until then every tag it',
      'defines is an unknown one — in the editor, in `markout build`, and in CI.'
    );
  } else if (!row.installed) {
    lines.push('Not installed. Tick to fetch it into `.markout/kits/`.');
  } else if (!row.managed) {
    lines.push(
      `Installed at \`${row.installed}\` by **npm**, in \`node_modules\`.`,
      '',
      '`package.json` and your lockfile own this one, so the checkbox cannot',
      'remove it — use `npm uninstall` for that.'
    );
  } else {
    lines.push(`Installed at \`${row.installed}\` in \`.markout/kits/\`.`);
    pending && lines.push('', `**${row.available}** is available.`);
  }
  const md = new vscode.MarkdownString(lines.join('\n'));
  md.supportThemeIcons = true;
  return md;
}

class KitsProvider implements vscode.TreeDataProvider<Row> {
  private changed = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private view?: vscode.TreeView<Row>;
  private rows: KitRow[] = [];
  private errors: string[] = [];
  private dir?: string;
  /** the project this window is about, as Preview and Build also need it */
  docroot?: string;
  /** the registry's answer for each kit, once asked; absent means not asked */
  private latest = new Map<string, string>();
  /** this project's own kits, from the registry; empty until asked, or offline */
  private offered: { name: string; description?: string }[] = [];
  private busy = false;

  constructor(private context: vscode.ExtensionContext) {}

  attach(view: vscode.TreeView<Row>) {
    this.view = view;
  }

  getTreeItem(row: Row): vscode.TreeItem {
    if (row.kind === 'doc') {
      const item = new vscode.TreeItem('Who is this for?');
      item.iconPath = new vscode.ThemeIcon('question');
      item.command = { command: 'markout.whoIsThisFor', title: 'Who is this for?' };
      item.tooltip = new vscode.MarkdownString(
        'Markout has two ways to install a kit — npm if you have Node, these ' +
          'checkboxes if you do not. This explains which is yours, and why the ' +
          'second exists.'
      );
      return item;
    }
    if (row.kind === 'error') {
      const item = new vscode.TreeItem(row.message);
      item.iconPath = new vscode.ThemeIcon('error');
      item.tooltip = row.message;
      return item;
    }
    return new KitItem(row.row, isBumpPending(row.row, this.declined()));
  }

  getChildren(): Row[] {
    if (!this.dir) {
      return [];
    }
    return [
      { kind: 'doc' } as Row,
      ...this.errors.map(message => ({ kind: 'error', message }) as Row),
      ...this.rows.map(row => ({ kind: 'kit', row }) as Row),
    ];
  }

  /**
   * Re-read the project, and optionally ask the registry what is current.
   *
   * The registry is asked only when something asked for it -- opening the
   * view, or the refresh button -- and never on a file change. A sidebar that
   * hit the network every time a page was saved would be a sidebar people
   * turn off.
   */
  async refresh(lookUp = false) {
    const docroot = findDocroot(
      (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
      vscode.workspace.getConfiguration('markout').get<string | string[]>('docroot')
    );
    this.docroot = docroot;
    this.dir = docroot ? manifestDirFor(docroot) : undefined;
    await vscode.commands.executeCommand('setContext', 'markout.hasProject', !!docroot);
    if (!docroot || !this.dir) {
      this.rows = [];
      this.errors = [];
      this.changed.fire(undefined);
      return;
    }
    const found = projectKits(docroot, this.dir, this.offered);
    this.errors = found.errors;
    this.rows = found.rows.map(row => ({ ...row, available: this.latest.get(row.name) }));
    this.changed.fire(undefined);
    if (lookUp) {
      await this.lookUpOffered();
      await this.lookUpVersions();
    }
    this.updateBadge();
  }

  /**
   * The kits this project publishes, so an empty project has something to
   * tick. Asked of the registry rather than hard-coded, so a new one appears
   * without an extension release.
   */
  private async lookUpOffered() {
    try {
      this.offered = await featuredKits();
    } catch {
      // offline. Nothing is lost that was not already lost: this list exists
      // to install from, and installing needs the registry too
      this.offered = [];
      return;
    }
    if (this.docroot && this.dir) {
      const found = projectKits(this.docroot, this.dir, this.offered);
      this.errors = found.errors;
      this.rows = found.rows.map(row => ({ ...row, available: this.latest.get(row.name) }));
      this.changed.fire(undefined);
    }
  }

  /** what the registry currently has for every kit on show */
  private async lookUpVersions() {
    await Promise.all(
      this.rows.map(async row => {
        try {
          const resolved = await resolveKit(row.name);
          this.latest.set(row.name, resolved.version);
        } catch {
          // offline, or a kit that is not published: neither is worth a
          // notification, and the row is perfectly readable without a bump
        }
      })
    );
    this.rows = this.rows.map(row => ({ ...row, available: this.latest.get(row.name) }));
    this.changed.fire(undefined);
  }

  /**
   * The count on the activity bar icon.
   *
   * A number rather than a notification per bump: nobody has to act on these
   * today, and an ambient count is what that deserves. Cleared to undefined
   * at zero, so the icon is unmarked rather than wearing a `0`.
   */
  private updateBadge() {
    const count = pendingBumps(this.rows, this.declined());
    if (this.view) {
      this.view.badge = count
        ? { value: count, tooltip: `${count} kit update${count > 1 ? 's' : ''} available` }
        : undefined;
    }
  }

  private declined(): Record<string, string> {
    return this.context.workspaceState.get<Record<string, string>>(DECLINED) ?? {};
  }

  /** a tick installs, an untick removes -- and an untick may be refused */
  async toggled(items: readonly [Row, vscode.TreeItemCheckboxState][]) {
    for (const [row, state] of items) {
      if (row.kind !== 'kit') {
        continue;
      }
      if (state === vscode.TreeItemCheckboxState.Checked) {
        await this.install(row.row.name);
      } else {
        await this.remove(row.row);
      }
    }
  }

  private async install(name: string) {
    if (!this.docroot || this.busy) {
      return this.refresh();
    }
    const docroot = this.docroot;
    this.busy = true;
    try {
      const report = await vscode.window.withProgress(
        { location: { viewId: 'markout.kits' }, title: `Installing ${name}` },
        () => addKits(docroot, [name])
      );
      report.errors.forEach(message => vscode.window.showErrorMessage(`Markout: ${message}`));
    } finally {
      this.busy = false;
      await this.refresh();
    }
  }

  /**
   * Remove a kit, unless a page still uses it.
   *
   * Refused rather than confirmed-with-a-warning, and the refusal names the
   * pages. A kit taken out from under a page that imports it produces exactly
   * the silent failure the manifest exists to end -- a blank region and no
   * message -- and the sidebar is the last place that should be creating one.
   */
  private async remove(row: KitRow) {
    if (!this.docroot || !this.dir) {
      return;
    }
    if (!row.managed) {
      vscode.window.showInformationMessage(
        `Markout: ${row.name} was installed by npm. Remove it with ` +
          `\`npm uninstall ${row.name}\` — this view does not edit node_modules.`
      );
      return this.refresh();
    }
    const kit = { name: row.name, root: rootOf(this.dir, row.name) };
    const using = pagesUsing(this.docroot, kit);
    if (using.length) {
      const shown = using.slice(0, 5).join(', ');
      const more = using.length > 5 ? `, and ${using.length - 5} more` : '';
      vscode.window.showWarningMessage(
        `Markout: ${row.name} is still used by ${shown}${more}. Remove the ` +
          `imports first — taking the kit away now would leave those pages ` +
          `rendering nothing, with no error to say why.`
      );
      return this.refresh();
    }
    fs.rmSync(managedKitDir(this.dir, row.name), { recursive: true, force: true });
    const pins = { ...readManifest(this.dir).manifest.kits };
    delete pins[row.name];
    writeManifest(this.dir, { kits: pins });
    await this.refresh();
  }

  /** the whole registry, behind a deliberate second step */
  async search() {
    if (!this.docroot) {
      return;
    }
    const text = await vscode.window.showInputBox({
      title: 'Search the npm registry for Markout kits',
      prompt: 'Packages that declare the `markout-kit` keyword. Leave empty for all.',
      placeHolder: 'table, charts, forms…',
    });
    if (text === undefined) {
      return;
    }
    let found: KitListing[];
    try {
      found = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Searching npm…' },
        () => searchKits(text)
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Markout: ${(e as Error).message}`);
      return;
    }
    const installed = new Set(this.rows.filter(r => r.installed).map(r => r.name));
    const picked = await vscode.window.showQuickPick(
      found
        .filter(kit => !installed.has(kit.name))
        .map(kit => ({
          label: kit.name,
          description: kit.version,
          detail: kit.description,
        })),
      {
        title: 'Install a kit',
        // Said here rather than in a dialog afterwards, where it would be a
        // warning nobody reads.
        //
        // Both halves are true and neither is the sandboxed one: compile-time
        // evaluation is contained (see docs/design/code-execution.md), so what
        // is worth a reader's attention is that a kit's code compiles into
        // every page they ship and runs unsandboxed in Node whenever they
        // preview.
        placeHolder:
          "A kit's code goes into your pages, and runs here when you " +
          'preview — install ones you trust',
      }
    );
    picked && (await this.install(picked.label));
  }

  /** the sidebar's `markout restore`, for a clone whose kits/ is not there */
  async restore() {
    if (!this.docroot) {
      return;
    }
    const docroot = this.docroot;
    const report = await vscode.window.withProgress(
      { location: { viewId: 'markout.kits' }, title: 'Restoring kits' },
      () => restoreKits(docroot)
    );
    report.errors.forEach(message => vscode.window.showErrorMessage(`Markout: ${message}`));
    await this.refresh();
  }

  async acceptBump(row?: KitRow) {
    row?.available && (await this.install(`${row.name}@${row.available}`));
  }

  /**
   * Decline this version, and stop asking about it.
   *
   * Recorded per version rather than as a flag, so the next release asks
   * again: "not this one" is what a decline means, and turning it into
   * "never" would make the button one nobody dares press.
   */
  async declineBump(row?: KitRow) {
    if (!row?.available) {
      return;
    }
    await this.context.workspaceState.update(DECLINED, {
      ...this.declined(),
      [row.name]: row.available,
    });
    this.changed.fire(undefined);
    this.updateBadge();
  }
}

/** a managed kit's declared root, read from the copy on disk */
function rootOf(dir: string, name: string): string | undefined {
  try {
    const json = JSON.parse(
      fs.readFileSync(path.join(managedKitDir(dir, name), 'package.json'), 'utf8')
    );
    return typeof json?.markout?.root === 'string' ? json.markout.root : undefined;
  } catch {
    return;
  }
}
