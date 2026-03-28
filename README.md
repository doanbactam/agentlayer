# agentlayer

Intelligent context routing for AI coding agents.

## Install

```bash
npm install -g agentlayer
```

Or run from source:

```bash
npm install
npm run build
node dist/cli/index.js --help
```

## Purpose

`agentlayer` scans a project, stores reusable context in `.agentlayer/context.db`, exports a git-friendly `.agentlayer/context.jsonl`, and exposes that context back to agent tools through CLI commands, hooks, and an MCP server.

## Runtime

- Node.js 22 or newer is required.
- Hooks now run on Node, not Bun.
- Native dependency: `better-sqlite3`.

If `better-sqlite3` fails to install, verify that you are on Node 22+ and using a supported platform toolchain for native modules.

## Quick Start

```bash
npm install
npm run build
node dist/cli/index.js init
node dist/cli/index.js scan
node dist/cli/index.js status
```

After build, the CLI entrypoint is `dist/cli/index.js`. When installed globally, use `agentlayer`.

## Install Targets

- Global CLI: `npm install -g agentlayer`
- Local dev dependency: `npm install --save-dev agentlayer`
- Programmatic imports: `import { startServer, ContextStore } from "agentlayer"`

## Main Commands

- `agentlayer init`: initialize `.agentlayer/` and create the first context snapshot
- `agentlayer scan`: rescan files and refresh derived rules
- `agentlayer health`: inspect coverage, staleness, and behavior signals
- `agentlayer hooks <claude|codex>`: install editor/agent hooks
- `agentlayer serve`: start the MCP server over stdio
- `agentlayer push`: export DB state to `.agentlayer/context.jsonl`
- `agentlayer pull`: import `.agentlayer/context.jsonl` into the local DB

## Hooks

Installing hooks writes generated scripts into `.agentlayer/hooks/` and a local runtime config into `.agentlayer/config.json`.

- Claude config target: `.claude/settings.local.json`
- Codex config target: `.codex/config.json`

Generated hooks call back into the current CLI build using Node:

- `pre-tool-use.mjs`
- `post-tool-use.mjs`
- `post-commit.mjs`

If your editor or agent runner invokes hooks through a shell, keep the generated `node .agentlayer/hooks/*.mjs` commands unchanged.

## MCP

Run:

```bash
agentlayer serve
```

The server uses stdio and exposes these tools:

- `get_context`
- `get_health`
- `annotate_file`
- `log_behavior`
- `find_gaps`

## Development

```bash
npm run typecheck
npm test
npm run smoke
npm run pack:check
```

CI runs the same checks on Node 22.

## Release

For a public npm release, run:

```bash
npm run release:check
```

Detailed release steps live in `RELEASING.md`.
