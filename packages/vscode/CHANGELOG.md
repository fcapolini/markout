# markout-vscode

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
