# AGENTS.md

Guidance for autonomous AI coding agents working on `@iamsyr/agentmind`.

## Project Overview

Intelligent context routing CLI and MCP server for AI coding agents. TypeScript/Node.js library with SQLite (sql.js) storage.

## Setup

```bash
npm install
npm run build
```

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to dist/ |
| `npm run typecheck` | Type check without emit |
| `npm run test` | Run all tests (node --test) |
| `npm run lint` | ESLint on src/ |
| `npm run format` | Prettier write on src/ |
| `npm run format:check` | Prettier check on src/ |
| `npm run smoke` | Verify CLI --help works |
| `npm run check` | typecheck + test |

## Architecture

```
src/
├── cli/           Commander CLI (index.ts + commands/)
├── mcp/           MCP server over stdio (server.ts)
├── store/         SQLite context store (schema.ts, db.ts, jsonl.ts)
├── bridge/        Multi-agent file claiming (state.ts, conflict.ts)
├── hooks/         Agent hook generators (claude.ts, codex.ts, template.ts)
├── learn/         Behavior analysis and rule generation (analyzer.ts, generator.ts)
├── behavior/      Behavior log insertion (log.ts)
├── adapters/      Output adapters (rules-render for .cursorrules etc.)
├── templates/     Stack templates (nextjs, sst, react-native, etc.)
├── router/        Context routing logic
├── scanner/       File classification and pattern detection
└── types/         Shared TypeScript interfaces (index.ts)
```

## Conventions

- TypeScript strict mode (`tsconfig.json` strict: true)
- ES modules (`"type": "module"` in package.json)
- Node.js >= 18
- camelCase for functions and variables, PascalCase for types/interfaces
- Underscore-prefixed params allowed (`_arg`) for unused params
- Tests use Node.js built-in test runner (`node:test`) in `test/` dir as `.test.mjs` files
- No `TODO` or `FIXME` without a linked issue reference: `TODO(#123)`

## Testing

Tests are in `test/` as `.test.mjs` files using `node:test`. Tests are built against `dist/` (pretest runs build).

```bash
npm test                    # Run all tests
node --test test/unit-store.test.mjs  # Run specific test file
```

## CI

GitHub Actions CI workflow runs on push/PR to master:
- typecheck, lint, test, format:check, build

Release workflow publishes to npm on version tags (`v*.*.*`).

## Key APIs

- `ContextStore` (src/store/schema.ts) - SQLite-backed context storage
- `AgentBridge` (src/bridge/state.ts) - Multi-agent file claiming
- `startServer` (src/mcp/server.ts) - MCP server entry point
- `analyzeBehaviors` (src/learn/analyzer.ts) - Learn rules from behavior log
