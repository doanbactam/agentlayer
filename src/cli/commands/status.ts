import chalk from "chalk"
import fs from "node:fs"
import path from "node:path"
import { ContextStore } from "../../store/schema.js"
import { formatBytes } from "../utils.js"
import type { ContextEntry, StoreHealth } from "../../types/index.js"

export async function status() {
  const cwd = process.cwd()
  const agentmindDir = path.join(cwd, ".agentmind")
  const dbPath = path.join(agentmindDir, "context.db")
  const jsonlPath = path.join(agentmindDir, "context.jsonl")

  if (!fs.existsSync(agentmindDir)) {
    console.error(
      chalk.red("\n  agentmind is not initialized in this project.")
    )
    console.error(
      chalk.gray("  Run `agentmind init` first.\n")
    )
    process.exit(1)
  }

  // Get health from store
  let health: StoreHealth | null = null
  let totalRules = 0
  let totalAnnotations = 0
  let totalBehaviors = 0
  let totalEntries = 0
  let filesWithoutContext: string[] = []

  let injectedSize = 0

  if (fs.existsSync(dbPath)) {
    const store = new ContextStore(cwd)
    try {
      health = store.getHealth()

      const rules = store.getEntries({ type: "rule" })
      const annotations = store.getEntries({ type: "annotation" })
      const behaviors = store.getBehaviors()

      totalRules = rules.length
      totalAnnotations = annotations.length
      totalBehaviors = behaviors.length

      // Estimate injected context size (what agentmind would emit)
      injectedSize = estimateInjectedSize(rules, annotations)

      // Find files with rules but no annotations
      const filesWithRules = new Set(
        rules.map((r) => r.path).filter(Boolean)
      )
      const filesWithAnnotations = new Set(
        annotations.map((a) => a.path).filter(Boolean)
      )
      for (const f of filesWithRules) {
        if (!filesWithAnnotations.has(f)) {
          filesWithoutContext.push(f)
        }
      }

      totalEntries = filesWithRules.size
    } catch {
      // Store may be empty or have issues
    }
    store.close()
  }

  // Estimate full dump size (CLAUDE.md or all context raw)
  const fullDumpSize = estimateFullDumpSize(cwd)

  // Calculate coverage
  const coverage =
    totalEntries > 0
      ? Math.round(
          ((totalEntries - filesWithoutContext.length) / totalEntries) * 100
        )
      : 0

  // Render dashboard
  console.log("")
  console.log(chalk.bold("  agentmind status"))
  console.log(chalk.gray("  " + "\u2500".repeat(40)))
  console.log("")

  // Context coverage
  const coverageColor =
    coverage >= 80
      ? chalk.green
      : coverage >= 50
        ? chalk.yellow
        : chalk.red

  console.log(
    `  Context coverage: ${coverageColor(coverage + "%")}`
  )
  console.log(
    `  ${renderBar(coverage, coverageColor)}`
  )
  console.log("")

  // Stats
  console.log(`  ${chalk.bold("Entries")}       ${totalEntries}`)
  console.log(`  ${chalk.bold("Rules")}         ${totalRules}`)
  console.log(`  ${chalk.bold("Annotations")}   ${totalAnnotations}`)
  console.log(`  ${chalk.bold("Behaviors")}     ${totalBehaviors}`)
  console.log("")

  // Health info
  if (health) {
    if (health.staleEntries > 0) {
      console.log(
        chalk.yellow(`  Stale entries:  ${health.staleEntries}`)
      )
    }
    if (health.orphanedRules > 0) {
      console.log(
        chalk.yellow(`  Orphaned rules: ${health.orphanedRules}`)
      )
    }
    if (health.staleEntries === 0 && health.orphanedRules === 0) {
      console.log(chalk.green("  \u2713 Store is healthy"))
    }
    console.log("")
  }

  // Token reduction estimate
  if (fullDumpSize > 0 && injectedSize > 0 && injectedSize < fullDumpSize) {
    const reduction = Math.round(((fullDumpSize - injectedSize) / fullDumpSize) * 100)
    const fullTokens = Math.round(fullDumpSize / 4)
    const injectTokens = Math.round(injectedSize / 4)
    console.log(`  Token reduction: ~${reduction}%`)
    console.log(chalk.gray(`    Full context dump: ${fullDumpSize.toLocaleString()} chars (~${fullTokens.toLocaleString()} tokens)`))
    console.log(chalk.gray(`    Agentmind inject: ${injectedSize.toLocaleString()} chars (~${injectTokens.toLocaleString()} tokens)`))
    console.log("")
  }

  // Files without context
  if (filesWithoutContext.length > 0) {
    console.log(
      chalk.yellow(
        `  Files without context (top 10 of ${filesWithoutContext.length}):`
      )
    )
    for (const f of filesWithoutContext.slice(0, 10)) {
      console.log(chalk.gray(`    - ${f}`))
    }
    if (filesWithoutContext.length > 10) {
      console.log(
        chalk.gray(`    ... and ${filesWithoutContext.length - 10} more`)
      )
    }
    console.log(
      chalk.gray(
        `\n  Run ${chalk.white("`agentmind annotate <file>`")} to add context.`
      )
    )
    console.log("")
  }

  // Store size
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath)
    console.log(
      chalk.gray(`  Store: ${formatBytes(stat.size)} at .agentmind/context.db`)
    )
  }
  if (fs.existsSync(jsonlPath)) {
    const stat = fs.statSync(jsonlPath)
    console.log(
      chalk.gray(`  JSONL: ${formatBytes(stat.size)} at .agentmind/context.jsonl`)
    )
  }
  console.log("")
}

function renderBar(
  percentage: number,
  color: (s: string) => string
): string {
  const width = 30
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty)
  return color(`  [${bar}]`)
}


function estimateFullDumpSize(root: string): number {
  // Check for CLAUDE.md at project root
  const claudePath = path.join(root, "CLAUDE.md")
  if (fs.existsSync(claudePath)) {
    return fs.readFileSync(claudePath, "utf-8").length
  }
  return 0
}

function estimateInjectedSize(rules: ContextEntry[], annotations: ContextEntry[]): number {
  // Approximate what inject would output for a typical routed query
  // Header + each entry's rules/annotations rendered as markdown
  const header = "# Agentmind Context\n\nRelevant context from the project knowledge base:\n\n"
  let size = header.length

  for (const e of rules) {
    size += `## ${e.path}\n\n`.length
    size += "Classification: source\n\n".length
    if (e.rules.length > 0) {
      size += "### Rules\n".length
      for (const r of e.rules) {
        size += `- ${r.pattern}: ${r.description}\n`.length
      }
      size += 1 // blank line
    }
  }

  for (const e of annotations) {
    size += `## ${e.path}\n\n`.length
    if (e.annotations.length > 0) {
      size += "### Annotations\n".length
      for (const a of e.annotations) {
        const lineRef = a.line ? ` (line ${a.line})` : ""
        size += `- ${a.text}${lineRef}\n`.length
      }
      size += 1
    }
  }

  return size
}
