# Releasing agentlayer

## Preconditions

- Node 22 or newer is installed.
- Native install for `better-sqlite3` succeeds on the release machine.
- You are authenticated with npm if publishing.

## Release check

```bash
npm install
npm run release:check
```

This runs:

- typecheck
- tests
- CLI smoke check
- `npm pack --dry-run`

## Version and publish

1. Update `package.json` version.
2. Add release notes to `CHANGELOG.md`.
3. Run `npm run release:check`.
4. Inspect `npm pack --dry-run` output and confirm only distributable files are included.
5. Publish:

```bash
npm publish
```

## Post-release verification

Verify a clean install works:

```bash
npm install -g agentlayer
agentlayer --help
```
