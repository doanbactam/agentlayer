---
name: codebase-knowledge
description: Navigate and understand the agentmind TypeScript codebase - architecture, patterns, module boundaries, and conventions.
---

# Codebase Knowledge

You are working on `@iamsyr/agentmind`, an intelligent context routing CLI and MCP server for AI coding agents.

## Architecture

The codebase follows a modular architecture with clear boundaries:

- **cli/** — Commander-based CLI entry point and command handlers
- **mcp/** — MCP server implementation over stdio (JSON-RPC)
- **store/** — SQLite (sql.js) context storage with schema, JSONL import/export
- **bridge/** — Multi-agent file claiming and conflict detection
- **hooks/** — Auto-generated hook scripts for Claude Code and Codex agents
- **learn/** — Behavior pattern analysis and rule generation
- **behavior/** — Behavior log insertion helper
- **adapters/** — Output rendering (e.g., .cursorrules format)
- **templates/** — Stack-specific context templates (Next.js, SST, etc.)
- **router/** — Context routing and file classification
- **scanner/** — File classification and dependency graph building
- **types/** — Shared TypeScript interfaces

## Key Patterns

- All database operations go through `ContextStore` (store/schema.ts) or `SqliteDatabase` (store/db.ts)
- MCP tool handlers follow a `handle*` function pattern in mcp/server.ts
- CLI commands are registered in cli/index.ts, implemented in cli/commands/
- Hooks generate JavaScript files that call the CLI's `log-behavior` command
- Tests use Node.js built-in `node:test` runner with `.test.mjs` files in test/

## Conventions

- TypeScript strict mode, ES modules, Node.js >= 18
- camelCase for functions/variables, PascalCase for types/interfaces
- ESLint + Prettier for code quality and formatting
- Build command: `npm run build`, Test: `npm test`
