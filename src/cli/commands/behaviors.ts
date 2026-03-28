import chalk from "chalk"
import * as fs from "node:fs"
import * as path from "node:path"
import { ContextStore } from "../../store/schema.js"

interface BehaviorsOptions {
  limit?: string
}

interface BehaviorRow {
  id: number
  agent_type: string
  action: string
  file_path: string | null
  success: number
  timestamp: string
  metadata: string
}

export async function showBehaviors(options: BehaviorsOptions): Promise<void> {
  const projectRoot = process.cwd()
  const storePath = path.join(projectRoot, ".agentlayer", "context.db")

  if (!fs.existsSync(storePath)) {
    console.error(
      chalk.red("\n  agentlayer is not initialized in this project.")
    )
    console.error(
      chalk.gray("  Run `agentlayer init` first.\n")
    )
    process.exit(1)
  }

  const store = new ContextStore(projectRoot)

  try {
    const limit = parseInt(options.limit ?? "20", 10)

    const rows = store.getDb()
      .query("SELECT * FROM behavior_log ORDER BY timestamp DESC LIMIT ?")
      .all(limit) as BehaviorRow[]

    if (rows.length === 0) {
      console.log(chalk.gray("\n  No behavior entries yet.\n"))
      return
    }

    console.log("")
    console.log(chalk.bold("  Recent agent behavior"))
    console.log(chalk.gray("  " + "\u2500".repeat(72)))
    console.log("")

    const actionWidth = 24
    const fileWidth = 36
    const statusWidth = 8

    const header =
      "  " +
      chalk.gray.dim("TIMESTAMP".padEnd(20)) +
      "  " +
      chalk.gray.dim(truncate("ACTION", actionWidth).padEnd(actionWidth)) +
      "  " +
      chalk.gray.dim(truncate("FILE", fileWidth).padEnd(fileWidth)) +
      "  " +
      chalk.gray.dim("STATUS".padEnd(statusWidth))

    console.log(header)
    console.log(chalk.gray("  " + "\u2500".repeat(72)))

    for (const row of rows) {
      const timestamp = formatTimestamp(row.timestamp)
      const action = truncate(row.action, actionWidth)
      const filePath = truncate(row.file_path ?? "-", fileWidth)
      const status = row.success
        ? chalk.green("ok")
        : chalk.red("fail")

      console.log(
        "  " +
        chalk.gray(timestamp.padEnd(20)) +
        "  " +
        action.padEnd(actionWidth) +
        "  " +
        chalk.gray(filePath.padEnd(fileWidth)) +
        "  " +
        status
      )
    }

    console.log("")
    console.log(chalk.gray(`  Showing ${rows.length} entries. Use --limit to see more.`))
    console.log("")
  } catch (error) {
    console.error(chalk.red("  Error reading behavior log:"), error)
    process.exit(1)
  } finally {
    store.close()
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return "..." + s.slice(s.length - maxLen + 3)
}

function formatTimestamp(ts: string): string {
  return ts.replace("T", " ").slice(0, 19)
}
