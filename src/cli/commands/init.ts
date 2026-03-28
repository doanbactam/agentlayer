import chalk from "chalk"
import ora from "ora"
import fs from "node:fs"
import path from "node:path"
import { scan as runFullScan } from "../../scanner/index.js"
import { ContextStore } from "../../store/schema.js"
import { exportJSONL } from "../../store/jsonl.js"
import { buildEntries } from "../utils.js"
import type {
  ScanResult,
  FileClassification,
} from "../../types/index.js"

export async function init() {
  const cwd = process.cwd()
  const agentmindDir = path.join(cwd, ".agentmind")
  const dbPath = path.join(agentmindDir, "context.db")
  const jsonlPath = path.join(agentmindDir, "context.jsonl")

  const isProject = detectProject(cwd)
  if (!isProject) {
    console.error(
      chalk.red("\n  No project detected in current directory.")
    )
    console.error(
      chalk.gray(
        "  Run this command from a project root (needs package.json, .git, or source files).\n"
      )
    )
    process.exit(1)
  }

  if (fs.existsSync(agentmindDir)) {
    console.error(
      chalk.yellow("\n  agentmind is already initialized in this project.")
    )
    console.error(
      chalk.gray("  Run `agentmind scan` to update context.\n")
    )
    process.exit(1)
  }

  const spinner = ora("Scanning project...").start()

  let result: ScanResult
  try {
    result = await runFullScan(cwd)
    spinner.succeed(`Scanned ${result.files.length} files`)
  } catch (err) {
    spinner.fail("Scan failed")
    console.error(
      chalk.red(`\n  ${err instanceof Error ? err.message : "Unknown error"}\n`)
    )
    process.exit(1)
  }

  fs.mkdirSync(agentmindDir, { recursive: true })

  const store = new ContextStore(cwd)

  try {
    const entries = buildEntries(result).filter(e => e.rules.length > 0)
    store.replaceRules("scanner", entries.flatMap((entry) => entry.rules))

    const jsonl = exportJSONL(store)
    fs.writeFileSync(jsonlPath, jsonl, "utf-8")
  } finally {
    store.close()
  }

  updateGitignore(cwd)

  const classificationCounts = countClassifications(result.classifications)

  console.log("")
  console.log(
    chalk.green("  \u2713") +
      ` Scanned ${chalk.bold(result.files.length)} files` +
      formatClassificationList(classificationCounts)
  )
  console.log(
    chalk.green("  \u2713") +
      ` Found ${chalk.bold(result.patterns.length)} non-inferable pattern${result.patterns.length !== 1 ? "s" : ""}`
  )
  console.log(
    chalk.green("  \u2713") +
      ` Extracted ${chalk.bold(result.patterns.length)} rule${result.patterns.length !== 1 ? "s" : ""}`
  )
  console.log(
    chalk.green("  \u2713") +
      ` Context store: ${chalk.cyan(".agentmind/context.db")}`
  )
  console.log(
    chalk.green("  \u2713") +
      ` Git-ready: ${chalk.cyan(".agentmind/context.jsonl")}`
  )
  console.log("")

  if (result.patterns.length > 0) {
    console.log(chalk.yellow("  Non-inferable patterns that need attention:"))
    for (const p of result.patterns.slice(0, 5)) {
      console.log(
        chalk.gray(`    - ${p.path}`) +
          (p.line ? chalk.gray(`:${p.line}`) : "") +
          chalk.white(` ${p.reason}`)
      )
    }
    if (result.patterns.length > 5) {
      console.log(
        chalk.gray(`    ... and ${result.patterns.length - 5} more`)
      )
    }
    console.log(
      chalk.gray(
        `\n  Run ${chalk.white("`agentmind annotate <file>`")} to add context for these patterns.`
      )
    )
    console.log("")
  }

  console.log(
    chalk.gray(
      `  Next: ${chalk.white("`agentmind status`")} to check context health`
    )
  )
  console.log("")
}

function detectProject(cwd: string): boolean {
  const markers = [
    "package.json",
    ".git",
    "tsconfig.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "pom.xml",
    "Gemfile",
    "Makefile",
  ]

  for (const marker of markers) {
    if (fs.existsSync(path.join(cwd, marker))) return true
  }

  // Check for source files
  const sourcePatterns = ["*.{ts,js,tsx,jsx,py,go,rs,java}"]
  for (const pattern of sourcePatterns) {
    const files = fs.readdirSync(cwd)
    if (files.some((f) => f.match(/\.(ts|js|tsx|jsx|py|go|rs|java)$/))) {
      return true
    }
  }

  return false
}

function countClassifications(
  classifications: Map<string, FileClassification>
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const cls of classifications.values()) {
    counts[cls] = (counts[cls] || 0) + 1
  }
  return counts
}

function formatClassificationList(
  counts: Record<string, number>
): string {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${type}`)
  return parts.length > 0 ? ` (${parts.join(", ")})` : ""
}

function updateGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, ".gitignore")
  const entry = ".agentmind/context.db"

  if (!fs.existsSync(gitignorePath)) return

  const content = fs.readFileSync(gitignorePath, "utf-8")
  if (content.includes(entry)) return

  const newContent = content.trimEnd() + "\n\n# agentmind\n.agentmind/context.db\n"
  fs.writeFileSync(gitignorePath, newContent)
}
