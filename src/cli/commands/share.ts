import chalk from "chalk"
import { execSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { ContextStore } from "../../store/schema.js"
import type { ContextEntry, StoreHealth } from "../../types/index.js"

export async function share(opts: { format?: string; output?: string }) {
  const cwd = process.cwd()
  const dbPath = join(cwd, ".agentmind", "context.db")

  if (!existsSync(dbPath)) {
    console.error(chalk.red("\n  agentmind is not initialized. Run `agentmind init` first.\n"))
    process.exit(1)
  }

  const store = new ContextStore(cwd)
  let entries: ContextEntry[]
  let health: StoreHealth
  try {
    entries = store.getEntries()
    health = store.getHealth()
  } finally {
    store.close()
  }

  if (entries.length === 0) {
    console.error(chalk.yellow("\n  No context entries found. Run `agentmind scan` first.\n"))
    process.exit(1)
  }

  const project = basename(cwd)
  const exported = new Date().toISOString()
  const format = opts.format ?? "json"

  const content =
    format === "curl"    ? renderCurl(entries, project, exported)
    : format === "markdown" ? renderMarkdown(entries, project, exported)
    : renderJSON(entries, project, exported, health)

  if (opts.output) {
    writeFileSync(opts.output, content, "utf-8")
    console.log(chalk.green("  \u2713") + ` Exported ${entries.length} entries to ${chalk.bold(opts.output)}`)
    return
  }

  console.log(content)
}

function renderJSON(entries: ContextEntry[], project: string, exported: string, health: StoreHealth): string {
  return JSON.stringify({
    version: "1.0",
    project,
    exported,
    entries,
    meta: {
      totalEntries: health.entries,
      staleEntries: health.staleEntries,
      orphanedRules: health.orphanedRules,
    },
  }, null, 2)
}

function renderMarkdown(entries: ContextEntry[], project: string, exported: string): string {
  const lines: string[] = []
  lines.push(`# ${project} context export`)
  lines.push(`> Project: ${project} | Exported: ${exported}`)
  lines.push("")

  const rules = entries.filter((e) => e.rules.length > 0)
  const annotations = entries.filter((e) => e.annotations.length > 0)
  const behaviors = entries.filter((e) => e.behaviors.length > 0)

  if (rules.length > 0) {
    lines.push("## Rules")
    for (const e of rules) {
      for (const r of e.rules) {
        lines.push(`- ${e.path}: ${r.description}`)
      }
    }
    lines.push("")
  }

  if (annotations.length > 0) {
    lines.push("## Annotations")
    for (const e of annotations) {
      for (const a of e.annotations) {
        const loc = a.line ? `:${a.line}` : ""
        lines.push(`- ${e.path}${loc}: ${a.text}`)
      }
    }
    lines.push("")
  }

  if (behaviors.length > 0) {
    lines.push("## Observed Patterns")
    for (const e of behaviors) {
      for (const b of e.behaviors) {
        lines.push(`- ${e.path}: ${b.description} (${b.frequency}x)`)
      }
    }
    lines.push("")
  }

  return lines.join("\n")
}

function renderCurl(entries: ContextEntry[], project: string, exported: string): string {
  const payload = JSON.stringify({ version: "1.0", project, exported, entries })
  const escaped = payload.replace(/'/g, "'\\''")
  return `curl -X POST https://api.github.com/gists \\
  -H "Content-Type: application/json" \\
  -d '${escaped}'`
}
