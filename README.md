# agentlayer

**Intelligent context routing for AI coding agents.**

[![npm version](https://img.shields.io/npm/v/agentlayer.svg)](https://www.npmjs.com/package/agentlayer)
[![Node.js Version](https://img.shields.io/node/v/agentlayer.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Why agentlayer?

AI coding agents (Claude Code, Codex, Cursor, Windsurf) work better when they understand your project. But:

- **Context is lost** when a session ends
- **You re-explain** the same things every session
- **No shared knowledge** between agents
- **Conflicts** when multiple agents edit the same files

**agentlayer fixes this** by:

1. **Scanning** your project and building a context map
2. **Storing** context in a git-friendly SQLite database
3. **Routing** the right context to the right agent/file on demand
4. **Exposing** it through CLI commands, hooks, and an MCP server

The result: agents understand your project faster, commit fewer bugs, and coordinate with each other.

---

## Install

```bash
# Global CLI
npm install -g agentlayer

# Or as a local dev dependency
npm install --save-dev agentlayer
```

**Requirements:** Node.js 22+ and native module `better-sqlite3`.

### Run from source

```bash
git clone https://github.com/your-org/agentlayer.git
cd agentlayer
npm install
npm run build
node dist/cli/index.js --help
```

---

## Quick Start

```bash
# 1. Initialize agentlayer in your project
agentlayer init

# 2. Scan project files and build context map
agentlayer scan

# 3. Check status
agentlayer status

# 4. (Optional) Start MCP server for agent integration
agentlayer serve
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Project Files                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Scanner                                                    │
│  - Classify files (config, source, test, docs...)          │
│  - Detect patterns (auth, api, database...)                │
│  - Build dependency graph                                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  ContextStore (SQLite)                                      │
│  - Annotations: human/agent notes per file                 │
│  - Rules: patterns to enforce                               │
│  - Behavior log: agent actions & outcomes                   │
│  - Project meta: stack, framework, conventions             │
└─────────────────────────────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  CLI Commands   │ │  Hooks System   │ │  MCP Server     │
│  - status       │ │  - pre-tool-use │ │  - get_context  │
│  - annotate     │ │  - post-tool-use│ │  - annotate_file│
│  - insights     │ │  - post-commit  │ │  - find_gaps    │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## CLI Reference

### Core Commands

| Command              | Description                                     | Options                    |
|----------------------|-------------------------------------------------|----------------------------|
| `init`               | Initialize agentlayer in the project            | —                          |
| `scan`               | Scan project files and build context map        | `-f, --force`, `--json`    |
| `status`             | Show status and health overview                 | —                          |
| `health`             | Dashboard with coverage, staleness, recs        | `--json`                   |
| `annotate <path>`    | Add a context annotation to a file              | `-l, --line <number>`      |

### Agent Integration

| Command              | Description                                     | Options                    |
|----------------------|-------------------------------------------------|----------------------------|
| `hooks <agent>`      | Install hooks for claude or codex               | —                          |
| `unhook <agent>`     | Remove hooks                                    | —                          |
| `serve`              | Start MCP server over stdio                     | —                          |
| `inject [query]`     | Inject context into current agent session       | `-f, --file <path>`        |

### Behavior & Insights

| Command              | Description                                     | Options                    |
|----------------------|-------------------------------------------------|----------------------------|
| `behaviors`          | Show recent agent behavior log                  | `-n, --limit <number>`     |
| `insights`           | Analyze patterns, find failure hotspots         | `--json`                   |
| `learn`              | Auto-generate rules from behavior patterns      | `--apply`, `--force`       |

### Multi-Agent Bridge

| Command                    | Description                                |
|----------------------------|--------------------------------------------|
| `bridge register`          | Register a new agent                       |
| `bridge claim`             | Claim files for editing (lock)             |
| `bridge release`           | Release claimed files                      |
| `bridge status`            | Show bridge status                         |
| `bridge conflicts`         | Show file conflicts                        |
| `agents`                   | List active agents and conflicts           |

### Sync & Share

| Command              | Description                                     | Options                         |
|----------------------|-------------------------------------------------|---------------------------------|
| `sync [tool]`        | Sync context to .cursorrules/.windsurfrules     | `--dry-run`                     |
| `unsync [tool]`      | Remove from editor rule files                   | —                               |
| `share`              | Export context snapshot                         | `-f json/md/curl`, `-o <file>`  |
| `push`               | Commit context changes                          | `-m <msg>`, `--remote`          |
| `pull`               | Pull remote context changes                     | `--force`                       |

### Templates

| Command                     | Description                                |
|-----------------------------|-------------------------------------------|
| `template list`             | List available templates                  |
| `template apply [name]`     | Apply a template to the project           |

### Interactive

| Command              | Description                                     | Options                    |
|----------------------|-------------------------------------------------|----------------------------|
| `overlay`            | Interactive annotation overlay                   | `--json`                   |

---

## MCP Server

Agentlayer provides an MCP server over stdio (protocol version 2024-11-05).

### Start server

```bash
agentlayer serve
```

### Available Tools

| Tool              | Description                                              | Parameters                              |
|-------------------|----------------------------------------------------------|----------------------------------------|
| `get_context`     | Get project context for the current task                  | `filePath?`, `query?`                  |
| `get_health`      | Check context health (coverage, staleness)                | —                                       |
| `annotate_file`   | Add a context annotation to a file                        | `filePath`, `text`, `priority?`        |
| `log_behavior`    | Log agent behavior (called automatically by hooks)        | `filePath`, `tool`, `success`          |
| `find_gaps`       | Find files missing context annotations                    | `directory?`                           |

### Config for Claude Desktop

```json
{
  "mcpServers": {
    "agentlayer": {
      "command": "node",
      "args": ["/path/to/agentlayer/dist/cli/index.js", "serve"]
    }
  }
}
```

---

## Hooks System

Hooks let agentlayer automatically track agent behavior and inject context.

### Install hooks

```bash
# Claude Code
agentlayer hooks claude

# Codex
agentlayer hooks codex
```

### Generated Files

```
.agentlayer/
├── hooks/
│   ├── pre-tool-use.mjs    # Runs before each tool call
│   ├── post-tool-use.mjs   # Runs after each tool call
│   └── post-commit.mjs     # Runs after git commit
└── config.json             # Hook runtime config
```

### Config Targets

| Agent  | Config File                    |
|--------|--------------------------------|
| Claude | `.claude/settings.local.json`  |
| Codex  | `.codex/config.json`           |

### Hook Behavior

- **pre-tool-use**: Log tool call, check file claims
- **post-tool-use**: Log success/failure, update patterns
- **post-commit**: Refresh context, export JSONL

---

## Multi-Agent Bridge

When multiple agents work concurrently, the Bridge prevents conflicts.

### Workflow

```
Agent A                     Agent B
   │                           │
   │  bridge register --id A   │
   │────────────────────────>  │
   │                           │
   │  bridge claim --files     │
   │  src/auth.ts              │
   │────────────────────────>  │  (src/auth.ts locked)
   │                           │
   │                           │  bridge claim src/auth.ts
   │                           │────────────────────────>
   │                           │  ✗ CONFLICT DETECTED
   │                           │
   │  bridge release           │
   │────────────────────────>  │  (src/auth.ts unlocked)
   │                           │  ✓ Can claim now
```

### Commands

```bash
# Register an agent
agentlayer bridge register --id agent-001 --tool claude

# Claim files (locks them)
agentlayer bridge claim --id agent-001 --files src/auth.ts src/api.ts

# Check status
agentlayer bridge status

# View conflicts
agentlayer bridge conflicts

# Release files
agentlayer bridge release --id agent-001 --files src/auth.ts
```

---

## Programmatic API

Use agentlayer as a library:

```typescript
import {
  startServer,
  ContextStore,
  importJSONL,
  exportJSONL,
  appendJSONL,
  scan,
  classify,
  detectPatterns,
  buildGraph,
} from "agentlayer"

// Types
import type {
  Annotation,
  BehaviorEntry,
  ContextEntry,
  DependencyGraph,
  DependencyNode,
  FileClassification,
  FileInfo,
  HookConfig,
  HookEvent,
  NonInferablePattern,
  ProjectMeta,
  Rule,
  ScanResult,
  StoreHealth,
} from "agentlayer"

// Initialize store
const store = new ContextStore("/path/to/project")

// Scan project
const result: ScanResult = await scan("/path/to/project")

// Export for git
exportJSONL(store, ".agentlayer/context.jsonl")

// Import from remote
importJSONL(store, ".agentlayer/context.jsonl")
```

---

## Templates

Templates are pre-built context configurations for popular stacks.

### Available Templates

| Template       | Detect Pattern          | Description                              |
|----------------|-------------------------|------------------------------------------|
| `nextjs`       | `next.config.*`         | Next.js app router, server components    |
| `sst`          | `sst.config.*`          | SST serverless stack                     |
| `react-native` | `app.json` + RN deps    | React Native mobile app                  |
| `python`       | `requirements.txt`      | Python project patterns                  |
| `go`           | `go.mod`                | Go module conventions                    |
| `rust`         | `Cargo.toml`            | Rust project structure                   |

### Usage

```bash
# List all templates
agentlayer template list

# Auto-detect and apply matching templates
agentlayer template apply --all

# Apply a specific template
agentlayer template apply nextjs
```

---

## Data Files & Git Integration

```
.agentlayer/
├── context.db       # SQLite database (local, do not commit)
├── context.jsonl    # Git-friendly export (commit to repo)
├── config.json      # Hook and runtime config
└── hooks/           # Generated hook scripts
```

### Git Workflow

```bash
# Export DB → JSONL (before committing)
agentlayer push -m "Update context"

# Import JSONL → DB (after pulling)
agentlayer pull
```

### .gitignore

```gitignore
# Do not commit (local state)
.agentlayer/context.db
.agentlayer/config.json

# Commit to repo (shared context)
# .agentlayer/context.jsonl
```

---

## Development

```bash
# Build
npm run build

# Type check
npm run typecheck

# Run tests
npm test

# Smoke test
npm run smoke

# Pack check
npm run pack:check

# Full release check
npm run release:check
```

### Scripts

| Script            | Description                                |
|-------------------|--------------------------------------------|
| `build`           | Compile TypeScript → dist/                 |
| `typecheck`       | Type check without emit                    |
| `test`            | Run tests with Node test runner            |
| `smoke`           | Verify CLI --help works                    |
| `pack:check`      | npm pack --dry-run                         |
| `release:check`   | Full check before npm publish              |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m "Add amazing feature"`
4. Push the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Code Style

- TypeScript strict mode
- ES modules (`type: module`)
- Node 22+ features are fine
- Tests required for new features

---

## License

[MIT](LICENSE) — Free for personal and commercial use.
