import chalk from "chalk"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ContextStore } from "../../store/schema.js"

interface HotFile {
  path: string
  total: number
  successes: number
  successRate: number
}

interface FailureHotspot {
  path: string
  total: number
  failures: number
  actions: string[]
}

interface ToolUsage {
  action: string
  count: number
}

interface InsightResult {
  totalEvents: number
  totalSuccesses: number
  successRate: number
  hotFiles: HotFile[]
  hotspots: FailureHotspot[]
  toolUsage: ToolUsage[]
}

export async function insights(opts: { json?: boolean }): Promise<void> {
  const root = process.cwd()
  const storePath = join(root, ".agentlayer", "context.db")

  if (!existsSync(storePath)) {
    console.log(chalk.yellow("No agentlayer store found. Run `agentlayer init` first."))
    return
  }

  const store = new ContextStore(root)
  const db = store.getDb()

  const totalRow = db.query("SELECT COUNT(*) as c FROM behavior_log").get() as { c: number }
  const totalEvents = totalRow.c

  if (totalEvents === 0) {
    console.log(chalk.dim("No behavior data recorded yet."))
    store.close()
    return
  }

  const successRow = db.query("SELECT SUM(success) as s FROM behavior_log").get() as { s: number | null }
  const totalSuccesses = successRow.s ?? 0
  const successRate = totalSuccesses / totalEvents

  // Top edited files with success breakdown
  const hotFileRows = db.query(`
    SELECT
      file_path,
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
    FROM behavior_log
    WHERE file_path IS NOT NULL AND file_path != ''
    GROUP BY file_path
    ORDER BY total DESC
    LIMIT 10
  `).all() as Array<{ file_path: string; total: number; successes: number }>

  const hotFiles: HotFile[] = hotFileRows.map((r) => ({
    path: r.file_path,
    total: r.total,
    successes: r.successes,
    successRate: r.successes / r.total,
  }))

  // Failure hotspots: files with the most failures
  const hotspotRows = db.query(`
    SELECT
      file_path,
      COUNT(*) as total,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      GROUP_CONCAT(DISTINCT CASE WHEN success = 0 THEN action END) as failed_actions
    FROM behavior_log
    WHERE file_path IS NOT NULL AND file_path != ''
    GROUP BY file_path
    HAVING failures > 0
    ORDER BY failures DESC, total DESC
    LIMIT 10
  `).all() as Array<{ file_path: string; total: number; failures: number; failed_actions: string | null }>

  const hotspots: FailureHotspot[] = hotspotRows.map((r) => ({
    path: r.file_path,
    total: r.total,
    failures: r.failures,
    actions: r.failed_actions ? r.failed_actions.split(",").slice(0, 3) : [],
  }))

  // Tool usage
  const toolRows = db.query(`
    SELECT action, COUNT(*) as count
    FROM behavior_log
    GROUP BY action
    ORDER BY count DESC
  `).all() as Array<{ action: string; count: number }>

  const toolUsage: ToolUsage[] = toolRows

  store.close()

  const result: InsightResult = { totalEvents, totalSuccesses, successRate, hotFiles, hotspots, toolUsage }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  renderDashboard(result)
}

function renderDashboard(r: InsightResult): void {
  const pct = (n: number) => Math.round(n * 100) + "%"
  const shorten = (s: string, max = 44) => s.length <= max ? s : "..." + s.slice(-(max - 3))

  console.log()
  console.log(chalk.bold("  agentlayer insights"))
  console.log(chalk.gray("  " + "\u2500".repeat(50)))
  console.log()

  // Top edited files
  if (r.hotFiles.length > 0) {
    console.log(chalk.bold("  Top edited files"))
    console.log()
    for (let i = 0; i < r.hotFiles.length; i++) {
      const f = r.hotFiles[i]
      const num = chalk.dim(`${i + 1}.`.padStart(4))
      const path = shorten(f.path, 40).padEnd(42)
      const edits = `${f.total} edits`.padEnd(10)
      const rateColor = f.successRate >= 0.8 ? chalk.green : f.successRate >= 0.5 ? chalk.yellow : chalk.red
      const rate = rateColor(`(${pct(f.successRate)} success)`)
      console.log(`  ${num} ${path} ${chalk.dim(edits)} ${rate}`)
    }
    console.log()
  }

  // Failure hotspots
  if (r.hotspots.length > 0) {
    console.log(chalk.bold("  Failure hotspots"))
    console.log()
    for (const h of r.hotspots) {
      const path = shorten(h.path, 40)
      const label = h.failures === 1 ? "failure" : "failures"
      console.log(`  ${chalk.red("\u26A0")} ${path}  ${chalk.red(`${h.failures} ${label}`)} ${chalk.dim("-- consider annotating")}`)
    }
    console.log()
  }

  // Tool usage
  if (r.toolUsage.length > 0) {
    console.log(chalk.bold("  Tool usage"))
    console.log()
    const parts = r.toolUsage.map((t) => `${t.action}: ${t.count}`)
    console.log("  " + parts.join("  "))
    console.log()
  }

  // Overall success rate
  const rateColor = r.successRate >= 0.8 ? chalk.green : r.successRate >= 0.5 ? chalk.yellow : chalk.red
  console.log(`  Overall success rate: ${rateColor(pct(r.successRate))} (${r.totalSuccesses}/${r.totalEvents})`)
  console.log()
}
