# Git Hooks

This directory contains Git hooks managed by [Husky](https://typicode.github.io/husky/).

## Pre-commit Hook

The `pre-commit` hook automatically runs before each commit to ensure code quality:

1. **Format Check**: Runs `npm run format:check` to verify all code follows Prettier formatting rules
2. **Tests**: Runs `npm test` to ensure all tests pass

## Manual Testing

You can manually run the same checks that the pre-commit hook performs:

```bash
npm run precommit
```

This is useful for:

- Testing your changes before committing
- Running the same validation in CI/CD pipelines
- Debugging formatting or test issues

## Bypass (Emergency Only)

In rare cases where you need to bypass the pre-commit hook (not recommended):

```bash
git commit --no-verify -m "emergency commit message"
```

## Setup for New Developers

The hooks are automatically installed when running `npm install` due to the `"prepare": "husky"` script in `package.json`.
