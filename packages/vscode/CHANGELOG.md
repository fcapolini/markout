# markout-vscode

## 0.5.3

### Patch Changes

- 7e6acb1: Say which tree the kits were read from, and stop swallowing the refusals.
  
  An unresolved tag reads the same whichever way a kit went missing, and the
  ways are not guessable from the page. A project with any kit of its own never
  consults the global tree, deliberately, so that a stray global copy cannot
  break a real project -- which means a globally installed kit is invisible in
  any project that has one of its own, correctly and silently. A machine with
  two npms has two global trees, only one of which holds what was installed.
  Both end in "no such tag", with nothing said anywhere about the directory
  that was actually read.
  
  The kit scan now reports what it did, once per distinct answer, to the
  Markout output channel: how many kits came from the project, or the global
  tree it read and what it found there, or that npm could not be reached and
  the login shell is being asked. It is background rather than a diagnostic --
  it is not a fault in the page being edited, and it is only wanted by someone
  already asking where their kit went.
  
  Kit refusals are the exception. `discoverKits` returns them as complete
  sentences -- a root claimed twice, a root shadowed by a real directory -- and
  the extension was discarding them, so a kit that was found and rejected
  produced a page full of unresolvable tags and no explanation at all. Those
  are now surfaced where they will be read.
- Updated dependencies [88ff5c1]
  - @markout-lang/core@0.6.1

## 0.5.2

### Patch Changes

- Find globally installed kits even when the editor's PATH has no npm on it.
  
  An editor started from the Dock or the Finder on macOS is a child of launchd,
  whose PATH holds no Homebrew, no nvm, no fnm and no volta -- and so no npm to
  ask where global packages are. VS Code resolves the login shell's environment
  to cover this, but it is best-effort and silently absent often enough to
  matter: the answer became "no global kits", and every tag the kit defines was
  reported as unknown, for exactly the author who installed globally so as not
  to have to `npm init` first.
  
  So the login shell is now asked as well, in the background, and the kits
  appear a moment after the window opens rather than not at all.

## 0.5.1

### Patch Changes

- Updated dependencies [523ef5e]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [5642d62]
- Updated dependencies [a4f641f]
- Updated dependencies [bd33a54]
  - @markout-lang/core@0.6.0
