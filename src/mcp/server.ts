import * as readline from "node:readline"
import * as fs from "node:fs"
import * as path from "node:path"
import { ContextStore } from "../store/schema.js"
import { route } from "../router/index.js"
import { formatBytes, formatContext } from "../cli/utils.js"
import type { ContextEntry, Annotation } from "../types/index.js"

// ── Tool definitions ───────────────────────────────────

const TOOLS = [
  {
    name: "get_context",
    description:
      "Get project context for the current task. Returns rules, annotations, and behavior history relevant to the file being edited.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string" as const, description: "File path to get context for" },
        query: { type: "string" as const, description: "Natural language query about the project" },
      },
    },
  },
  {
    name: "get_health",
    description:
      "Check project context health — coverage percentage, stale entries, files needing annotation.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "annotate_file",
    description:
      "Add a context annotation to a file. Use when you learn something about a file that future agent sessions should know.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string" as const, description: "File path" },
        text: { type: "string" as const, description: "Annotation text" },
        priority: {
          type: "string" as const,
          enum: ["critical", "high", "normal", "low"],
        },
      },
      required: ["filePath", "text"],
    },
  },
  {
    name: "log_behavior",
    description:
      "Log agent behavior — file edits, tool usage, success/failure. Called automatically by hooks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string" as const },
        tool: { type: "string" as const },
        success: { type: "boolean" as const },
      },
      required: ["filePath", "tool", "success"],
    },
  },
  {
    name: "find_gaps",
    description:
      "Find files that lack context annotations or rules. Helps identify where agentmind coverage is missing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        directory: { type: "string" as const, description: "Filter to a specific directory" },
      },
    },
  },
]

// ── JSON-RPC types ─────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ── Server ─────────────────────────────────────────────

export function startServer(projectRoot: string): void {
  const store = ensureStore(projectRoot)
  if (!store) {
    process.exit(1)
  }

  const rl = readline.createInterface({ input: process.stdin })

  const cleanup = () => {
    store.close()
    process.exit(0)
  }
  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)

  const handle = (line: string) => {
    let req: JsonRpcRequest
    try {
      req = JSON.parse(line)
    } catch {
      // Not valid JSON — skip per MCP spec
      return
    }

    const res = dispatch(req, store, projectRoot)
    if (res) {
      process.stdout.write(JSON.stringify(res) + "\n")
    }
  }

  rl.on("line", handle)
  log("agentmind MCP server ready (stdio)")
}

// ── Dispatch ───────────────────────────────────────────

function dispatch(req: JsonRpcRequest, store: ContextStore, projectRoot: string): JsonRpcResponse | null {
  const { id, method, params } = req

  // Notifications have no id — no response needed
  if (id == null && method === "notifications/initialized") return null

  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id: id as string | number | null, result })
  const error = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id: id as string | number | null, error: { code, message } })

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "agentmind", version: "0.1.0" },
      })

    case "ping":
      return reply({})

    case "tools/list":
      return reply({ tools: TOOLS })

    case "tools/call": {
      const name = (params as Record<string, unknown>)?.name as string
      const args = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>

      try {
        const result = handleToolCall(name, args, store, projectRoot)
        return reply({ content: [{ type: "text", text: result }] })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return error(-32603, msg)
      }
    }

    default:
      return error(-32601, `Method not found: ${method}`)
  }
}

// ── Tool handlers ──────────────────────────────────────

function handleToolCall(name: string, args: Record<string, unknown>, store: ContextStore, projectRoot: string): string {
  switch (name) {
    case "get_context": return handleGetContext(args, store)
    case "get_health": return handleGetHealth(store)
    case "annotate_file": return handleAnnotateFile(args, store, projectRoot)
    case "log_behavior": return handleLogBehavior(args, store)
    case "find_gaps": return handleFindGaps(args, store, projectRoot)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

function handleGetContext(args: Record<string, unknown>, store: ContextStore): string {
  const filePath = typeof args.filePath === "string" ? args.filePath : undefined
  const query = typeof args.query === "string" ? args.query : undefined

  let entries: ContextEntry[]

  if (filePath) {
    entries = store.queryContext({ filePath })
  } else if (query) {
    const all = store.getEntries()
    entries = route(query, all)
  } else {
    entries = store.getEntries({ scope: "global" })
  }

  if (entries.length === 0) return "No context entries found for this query."

  return formatContext(entries)
}

function handleGetHealth(store: ContextStore): string {
  const h = store.getHealth()
  const total = h.entries || 1
  const stalePct = Math.round((h.staleEntries / total) * 100)
  const orphans = h.orphanedRules

  const lines = [
    "# Context Health",
    "",
    `Total entries:    ${h.entries}`,
    `Stale entries:    ${h.staleEntries} (${stalePct}%)`,
    `Orphaned rules:   ${orphans}`,
    `Database size:    ${formatBytes(h.dbSize)}`,
    "",
  ]

  if (h.staleEntries > 0) lines.push("- Consider running `agentmind scan` to refresh stale entries.")
  if (orphans > 0) lines.push("- Some rules reference files with no annotations — use `find_gaps` to see them.")
  if (h.entries === 0) lines.push("- No context stored yet. Run `agentmind scan` and annotate key files.")

  return lines.join("\n")
}

function handleAnnotateFile(args: Record<string, unknown>, store: ContextStore, projectRoot: string): string {
  // Validate required parameters
  if (typeof args.filePath !== "string" || args.filePath.length === 0) {
    return "Error: filePath is required and must be a non-empty string."
  }
  if (typeof args.text !== "string" || args.text.length === 0) {
    return "Error: text is required and must be a non-empty string."
  }

  const filePath = args.filePath
  const text = args.text
  const priority = (typeof args.priority === "string" ? args.priority : null) || "normal"

  // Path containment check
  const resolved = path.resolve(projectRoot, filePath)
  if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
    return `Error: filePath must be within project root. Got: ${filePath}`
  }

  const valid = ["critical", "high", "normal", "low"]
  const normalizedPriority = valid.includes(priority) ? priority : "normal"

  const annotation: Annotation = {
    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path: filePath,
    text,
    author: "agent",
    created: Date.now(),
  }

  store.addAnnotation(annotation)
  store.setMeta(`priority:${annotation.id}`, normalizedPriority)

  return `Annotation saved for ${filePath} (priority: ${normalizedPriority}).`
}

function handleLogBehavior(args: Record<string, unknown>, store: ContextStore): string {
  // Validate required parameters
  if (typeof args.filePath !== "string") {
    return "Error: filePath is required and must be a string."
  }
  if (typeof args.tool !== "string" || args.tool.length === 0) {
    return "Error: tool is required and must be a non-empty string."
  }
  if (typeof args.success !== "boolean") {
    return "Error: success is required and must be a boolean."
  }

  const filePath = args.filePath
  const tool = args.tool
  const success = args.success

  store.getDb().run(
    "INSERT INTO behavior_log (agent_type, action, file_path, success, metadata) VALUES (?, ?, ?, ?, ?)",
    ["mcp", `tool:${tool}`, filePath, success ? 1 : 0, "{}"]
  )

  return `Behavior logged: ${tool} on ${filePath} (${success ? "success" : "failure"}).`
}

function handleFindGaps(args: Record<string, unknown>, store: ContextStore, projectRoot: string): string {
  const directory = typeof args.directory === "string" ? args.directory : undefined

  // Get paths with existing context
  const entries = store.getEntries()
  const covered = new Set<string>()
  for (const e of entries) {
    if (e.path) covered.add(e.path)
  }

  // Walk the filesystem to find source files without context
  const gaps: string[] = []
  const root = directory ? path.resolve(projectRoot, directory) : projectRoot
  if (!root.startsWith(projectRoot + path.sep) && root !== projectRoot) {
    return "Error: directory must be within project root."
  }
  walkFiles(root, projectRoot, covered, gaps)

  if (gaps.length === 0) return "No gaps found — all scanned files have context entries."

  const lines = [
    `# Context Gaps (${gaps.length} files without context)`,
    "",
  ]

  const display = gaps.slice(0, 50)
  for (const g of display) {
    lines.push(`- ${g}`)
  }
  if (gaps.length > 50) {
    lines.push(`- ... and ${gaps.length - 50} more`)
  }

  return lines.join("\n")
}

// ── Helpers ────────────────────────────────────────────

function ensureStore(projectRoot: string): ContextStore | null {
  const dbPath = path.join(projectRoot, ".agentmind", "context.db")
  if (!fs.existsSync(dbPath)) {
    log(`No .agentmind/context.db found in ${projectRoot}. Run 'agentmind init && agentmind scan' first.`)
    return null
  }
  return new ContextStore(projectRoot)
}

function log(msg: string): void {
  process.stderr.write(`[agentmind] ${msg}\n`)
}

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".cs", ".scala", ".clj",
  ".ex", ".exs", ".hs", ".zig", ".nim", ".lua", ".php",
  ".vue", ".svelte",
])

function walkFiles(dir: string, root: string, covered: Set<string>, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue

    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, root, covered, out)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name)
      if (!SOURCE_EXTS.has(ext)) continue
      const rel = path.relative(root, full).replace(/\\/g, "/")
      if (!covered.has(rel)) out.push(rel)
    }
  }
}
