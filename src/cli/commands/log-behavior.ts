import * as fs from "node:fs"
import * as path from "node:path"
import { resolve } from "node:path"
import { ContextStore } from "../../store/schema.js"

interface LogBehaviorOptions {
  file?: string
  tool?: string
  event?: string
  success?: string
}

/**
 * Internal command: log agent behavior from hooks.
 * Called by post-tool-use and post-commit hooks.
 * Exits silently unless AGENTLAYER_DEBUG is set.
 */
export async function logBehavior(options: LogBehaviorOptions): Promise<void> {
  const projectRoot = process.cwd()
  const storePath = path.join(projectRoot, ".agentlayer", "context.db")

  if (!fs.existsSync(storePath)) {
    process.exit(0)
  }

  const store = new ContextStore(projectRoot)

  try {
    const filePath = options.file ? resolve(projectRoot, options.file) : null
    const success = options.success !== "false"
    const action = options.tool
      ? `tool:${options.tool}`
      : options.event
        ? options.event
        : "unknown"

    const metadata = JSON.stringify({
      tool: options.tool ?? null,
      event: options.event ?? null,
    })

    store.getDb().run(
      "INSERT INTO behavior_log (agent_type, action, file_path, success, metadata) VALUES (?, ?, ?, ?, ?)",
      [
        options.event === "commit" ? "git" : "agent",
        action,
        filePath,
        success ? 1 : 0,
        metadata,
      ]
    )

    if (process.env.AGENTLAYER_DEBUG) {
      console.error(`[agentlayer] logged behavior: ${action} on ${filePath ?? "(unknown)"} success=${success}`)
    }
  } catch (error) {
    if (process.env.AGENTLAYER_DEBUG) {
      console.error("[agentlayer] log-behavior error:", error)
    }
  } finally {
    store.close()
  }

  process.exit(0)
}
