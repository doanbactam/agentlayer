# @iamsyr/agentmind

**Intelligent context routing for AI coding agents.**

[![npm version](https://img.shields.io/npm/v/@iamsyr/agentmind.svg)](https://www.npmjs.com/package/@iamsyr/agentmind)
[![Node.js Version](https://img.shields.io/node/v/@iamsyr/agentmind.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Table of Contents

- [What is agentmind?](#what-is-agentmind)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [CLI Commands](#cli-commands)
- [MCP Server](#mcp-server)
- [Hooks System](#hooks-system)
- [Multi-Agent Bridge](#multi-agent-bridge)
- [Programmatic API](#programmatic-api)
- [Development](#development)

---

## What is agentmind?

AI coding agents (Claude Code, Cursor, Windsurf, Codex) work better when they understand your project. But keeping that understanding across sessions is hard:

- **Context disappears** when a session ends
- **You repeat yourself** explaining the same things
- **Agents conflict** when editing the same files
- **No shared memory** between agents

agentmind solves this by scanning your project, storing context in a git-friendly database, and routing the right information to agents when they need it.

**Result:** Agents understand your code faster, make fewer mistakes, and work together without conflicts.

---

## Installation

```bash
# Global CLI (recommended)
npm install -g @iamsyr/agentmind

# Or as a dev dependency
npm install --save-dev @iamsyr/agentmind
```

**Requirements:** Node.js 22+

### Run from source

```bash
git clone https://github.com/doanbactam/agentmind.git
cd agentmind
npm install && npm run build
node dist/cli/index.js --help
```

---

## Quick Start

```bash
# 1. Initialize in your project
agentmind init

# 2. Scan files and build context
agentmind scan

# 3. Check the status
agentmind status

# 4. (Optional) Start MCP server for Claude Desktop
agentmind serve
```

That's it! Your project context is now tracked and ready to be used by agents.

---

## How It Works

```
Project Files → Scanner → ContextStore (SQLite)
                                ↓
              ┌─────────────────┼─────────────────┐
              ↓                 ↓                 ↓
         CLI Commands      Hooks System      MCP Server
```

**Scanner** classifies files (config, source, test, docs) and detects patterns (auth, API, database).

**ContextStore** keeps everything in a git-friendly SQLite database:
- Annotations per file
- Pattern rules
- Behavior logs
- Project metadata

**Interfaces** expose this data through CLI, hooks, and MCP.

---

## CLI Commands

### Essentials

| Command | What it does |
|---------|--------------|
| `init` | Set up agentmind in your project |
| `scan` | Scan files and build context map |
| `status` | Quick health overview |
| `health` | Detailed dashboard with coverage & recommendations |
| `annotate <path>` | Add a note to any file (`-l` for line-specific) |

### Agent Integration

| Command | What it does |
|---------|--------------|
| `hooks <agent>` | Install hooks for claude or codex |
| `unhook <agent>` | Remove installed hooks |
| `serve` | Start MCP server for Claude Desktop |
| `inject [query]` | Inject context into current session |

### Insights & Learning

| Command | What it does |
|---------|--------------|
| `behaviors` | Show recent agent actions |
| `insights` | Find patterns and failure hotspots |
| `learn` | Auto-generate rules from behavior (`--apply` to enable) |

### Multi-Agent Coordination

| Command | What it does |
|---------|--------------|
| `bridge register` | Register a new agent |
| `bridge claim` | Lock files for editing |
| `bridge release` | Release locked files |
| `bridge conflicts` | Show file conflicts |
| `agents` | List all active agents |

### Sync & Share

| Command | What it does |
|---------|--------------|
| `sync [tool]` | Export to .cursorrules or .windsurfrules |
| `share` | Export context snapshot (`-f json/md/curl`) |
| `push` | Commit context changes to git |
| `pull` | Pull and merge remote context |

---

## MCP Server

agentmind exposes its power through MCP (Model Context Protocol) for Claude Desktop and other MCP-compatible tools.

**Start:**
```bash
agentmind serve
```

**Available Tools:**

| Tool | Purpose |
|------|---------|
| `get_context` | Get context for a file or query |
| `get_claims` | Check which files are locked |
| `get_health` | Check context coverage |
| `annotate_file` | Add annotations programmatically |
| `log_behavior` | Track agent actions |
| `find_gaps` | Find files missing annotations |

**Claude Desktop Config:**
```json
{
  "mcpServers": {
    "agentmind": {
      "command": "node",
      "args": ["/path/to/agentmind/dist/cli/index.js", "serve"]
    }
  }
}
```

---

## Hooks System

Hooks automatically track agent behavior and inject context.

**Install:**
```bash
agentmind hooks claude   # or: agentmind hooks codex
```

**What gets created:**
```
.agentmind/
├── hooks/
│   ├── pre-tool-use.mjs    # Before each tool call
│   ├── post-tool-use.mjs   # After each tool call
│   └── post-commit.mjs     # After git commit
└── config.json
```

**What they do:**
- `pre-tool-use`: Log calls, check file locks
- `post-tool-use`: Log success/failure, update patterns
- `post-commit`: Refresh context, export JSONL

---

## Multi-Agent Bridge

When multiple agents work together, the Bridge prevents edit conflicts.

```bash
# Register your agent
agentmind bridge register --id agent-001 --tool claude

# Claim files (locks them for others)
agentmind bridge claim --id agent-001 --files src/auth.ts

# Check status
agentmind bridge status

# Release when done
agentmind bridge release --id agent-001 --files src/auth.ts
```

---

## Programmatic API

```typescript
import {
  ContextStore,
  scan,
  exportJSONL,
  importJSONL,
} from "@iamsyr/agentmind";

// Initialize store
const store = new ContextStore("/path/to/project");

// Scan project
const result = await scan("/path/to/project");

// Export for git
exportJSONL(store, ".agentmind/context.jsonl");

// Import from remote
importJSONL(store, ".agentmind/context.jsonl");
```

---

## Development

```bash
npm run build         # Compile TypeScript
npm run typecheck     # Type check
npm test              # Run tests
npm run smoke         # Quick sanity check
npm run release:check # Full pre-publish check
```

---

## Data Files

```
.agentmind/
├── context.db       # SQLite (local, don't commit)
├── context.jsonl    # Git-friendly export (commit this)
├── config.json      # Config (local)
└── hooks/           # Generated hook scripts
```

**Recommended .gitignore:**
```gitignore
.agentmind/context.db
.agentmind/config.json
```

---

## License

MIT — free for personal and commercial use.
