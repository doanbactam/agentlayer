import chalk from "chalk"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ContextStore } from "../../store/schema.js"
import { analyzeBehaviors, type LearnedRule } from "../../learn/analyzer.js"
import { generateRules, applyRules, type GeneratedRule } from "../../learn/generator.js"

interface LearnOptions {
  apply?: boolean
  force?: boolean
  json?: boolean
}

export async function learn(opts: LearnOptions): Promise<void> {
  const root = process.cwd()
  const storePath = join(root, ".agentlayer", "context.db")

  if (!existsSync(storePath)) {
    console.log(chalk.yellow("No agentlayer store found. Run `agentlayer init` first."))
    return
  }

  const store = new ContextStore(root)

  try {
    const raw = analyzeBehaviors(store)

    if (raw.length === 0) {
      const totalRow = store.getDb().query("SELECT COUNT(*) as c FROM behavior_log").get() as { c: number }
      if (totalRow.c === 0) {
        console.log(chalk.dim("No behavior data recorded yet."))
      } else {
        console.log(chalk.dim("No actionable patterns found in behavior data."))
      }
      return
    }

    const generated = generateRules(raw)

    const high = generated.filter((r) => r.confidence >= 0.8)
    const medium = generated.filter((r) => r.confidence >= 0.5 && r.confidence < 0.8)
    const low = generated.filter((r) => r.confidence < 0.5)

    if (opts.json) {
      console.log(JSON.stringify({ generated, summary: { high: high.length, medium: medium.length, low: low.length } }, null, 2))
      return
    }

    const totalBehaviors = (store.getDb().query("SELECT COUNT(*) as c FROM behavior_log").get() as { c: number }).c

    console.log()
    console.log(chalk.bold("  agentlayer learn"))
    console.log(chalk.gray("  " + "\u2500".repeat(54)))
    console.log()
    console.log(chalk.dim(`  Analyzing ${totalBehaviors} behavior entries...`))
    console.log()
    console.log(
      chalk.bold(`  Learned rules `) +
      chalk.green(`${high.length} high confidence`) + chalk.dim(", ") +
      chalk.yellow(`${medium.length} medium`) +
      (low.length > 0 ? chalk.dim(`, ${low.length} low (hidden)`) : "") +
      chalk.bold(":")
    )
    console.log()

    for (const gr of [...high, ...medium]) {
      const learned = raw.find((l) => l.filePath === gr.filePath && l.pattern === gr.rule.pattern)
      if (!learned) continue

      const isHigh = gr.confidence >= 0.8
      const tag = isHigh
        ? chalk.green("HIGH") + " " + chalk.green("\u2713")
        : chalk.yellow("MED ") + " " + chalk.yellow("\u25CB")

      const shortPath = shortenPath(gr.filePath)
      console.log(`  ${tag} ${chalk.bold(shortPath)}`)
      console.log(`    "${gr.rule.description}"`)

      const evidence = formatEvidence(learned)
      const confPct = Math.round(gr.confidence * 100)
      const confBar = confidenceBar(gr.confidence)
      console.log(`    Confidence: ${confPct}% ${confBar} | ${evidence}`)
      console.log()
    }

    if (opts.apply) {
      const toApply = opts.force
        ? generated.filter((r) => r.confidence >= 0.5)
        : generated.filter((r) => r.confidence >= 0.8)

      if (toApply.length === 0) {
        console.log(chalk.dim("  No rules meet the confidence threshold."))
        return
      }

      const applied = applyRules(store, toApply)
      console.log(chalk.green(`  Applied ${applied} learned rule${applied === 1 ? "" : "s"} to store.`))
    } else {
      console.log(chalk.dim("  Run `agentlayer learn --apply` to add high-confidence rules."))
      console.log(chalk.dim("  Run `agentlayer learn --apply --force` to add all rules."))
    }

    console.log()
  } finally {
    store.close()
  }
}

function shortenPath(p: string, max = 50): string {
  if (p.length <= max) return p
  return "..." + p.slice(-(max - 3))
}

function confidenceBar(confidence: number, width = 10): string {
  const filled = Math.round(confidence * width)
  const empty = width - filled
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty)

  if (confidence >= 0.8) return chalk.green(bar)
  if (confidence >= 0.5) return chalk.yellow(bar)
  return chalk.red(bar)
}

function formatEvidence(rule: LearnedRule): string {
  const parts: string[] = []

  if (rule.pattern === "frequent-failure") {
    parts.push(`${rule.evidence.length} failure${rule.evidence.length !== 1 ? "s" : ""}`)
  } else if (rule.pattern === "retry-loop") {
    parts.push(`${rule.evidence.length} edit${rule.evidence.length !== 1 ? "s" : ""}`)
    parts.push("retries")
  } else if (rule.pattern === "tool-mismatch") {
    parts.push(`${rule.evidence.length} failed attempt${rule.evidence.length !== 1 ? "s" : ""}`)
  } else if (rule.pattern === "success-pattern") {
    parts.push(`${rule.evidence.length} successful edit${rule.evidence.length !== 1 ? "s" : ""}`)
  } else if (rule.pattern === "time-pattern") {
    parts.push(`${rule.evidence.length} timed failure${rule.evidence.length !== 1 ? "s" : ""}`)
  }

  return parts.join(", ")
}
