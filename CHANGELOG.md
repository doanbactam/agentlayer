# Changelog

## 0.1.2 (unreleased)

### Bug fixes

- Wrap `replaceRules` in transaction to prevent data loss on crash.
- Fix `rowToEntry` using real classification/hash from DB instead of hardcoded values.
- Fix broken glob pattern matching in `queryContext` with `globToSqlLike` helper.
- Fix `split("\n")` bug in post-commit hook template.
- Fix `appendJSONL` losing annotation data when entry has multiple types.
- Fix `getBehaviors` discarding pattern/frequency metadata.
- Fix classify matcher order: config patterns before data patterns.
- Add Windows path normalization in classifier.
- Fix import regex missing space between `from` and quote in graph builder.
- Normalize paths to forward slashes for Windows compat in graph builder.
- Add `try/catch` around all unprotected `JSON.parse` calls.
- Add input validation for annotate CLI and MCP tool handlers.

### Refactoring

- Extract shared hook logic to `src/hooks/shared.ts` (claude/codex dedup).
- Extract shared adapter render to `src/adapters/rules-render.ts`.
- Extract `formatContext` utility to eliminate DRY violations.
- Merge double `ContextStore` connection in annotate command.
- Remove dead `classifyFromPath` in health command.
- Replace `SharedArrayBuffer` sleep with busy-wait in bridge state.

### CI/CD

- Add CI workflow (`.github/workflows/ci.yml`) for PR checks.
- Add release workflow (`.github/workflows/release.yml`) for npm publish.
- Add ESLint config and lint script.

### Tests

- Expand from 23 to 76 tests.
- New test suites: bridge (10), MCP tools (7), scanner (6), patterns (9), learn (5).

## 0.1.0

- First public npm-ready release of `@iamsyr/agentmind`.
- Node 22+ CLI with scan, hooks, MCP server, and context sync commands.
- Node-based generated hooks for Claude and Codex.
- CI, smoke checks, and integration coverage for hooks, MCP serve, and JSONL import safety.
