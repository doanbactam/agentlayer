import chalk from "chalk"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { ContextStore } from "../../store/schema.js"
import { appendJSONL } from "../../store/jsonl.js"
import { validatePriority } from "../utils.js"
import type { Annotation } from "../../types/index.js"

export async function annotate(
  filePath: string,
  text?: string,
  opts?: { line?: string }
) {
  const cwd = process.cwd()
  const agentmindDir = path.join(cwd, ".agentmind")

  if (!fs.existsSync(agentmindDir)) {
    console.error(
      chalk.red("\n  agentmind is not initialized in this project.")
    )
    console.error(
      chalk.gray("  Run `agentmind init` first.\n")
    )
    process.exit(1)
  }

  // Resolve file path
  const resolvedPath = path.resolve(cwd, filePath)
  if (!fs.existsSync(resolvedPath)) {
    console.error(
      chalk.red(`\n  File not found: ${filePath}`)
    )
    console.error(
      chalk.gray("  Check the path and try again.\n")
    )
    process.exit(1)
  }

  const relativePath = path.relative(cwd, resolvedPath).replace(/\\/g, "/")
  let lineNumber: number | undefined
  if (opts?.line) {
    const parsed = parseInt(opts.line, 10)
    if (Number.isNaN(parsed) || parsed < 1) {
      console.error(
        chalk.red(`\n  Invalid line number: "${opts.line}"`)
      )
      console.error(
        chalk.gray("  Line number must be a positive integer.\n")
      )
      process.exit(1)
    }
    lineNumber = parsed
  }

  // Show existing annotations for context
  const store = new ContextStore(cwd)
  try {
    const existing = store.getEntries({ filePath: relativePath, type: "annotation" })
    if (existing.length > 0) {
      console.log(
        chalk.cyan(`\n  Existing annotations for ${relativePath}:`)
      )
      for (const entry of existing) {
        const ann = entry.annotations[0]
        if (ann) {
          const lineInfo = ann.line ? chalk.gray(`:${ann.line}`) : ""
          console.log(chalk.gray(`    - ${ann.text}${lineInfo}`))
        }
      }
      console.log("")
    }
  } catch {
    // Store may be empty
  }
  store.close()

  // Get annotation text
  let annotationText = text
  if (!annotationText) {
    annotationText = await prompt("  Annotation: ")
    if (!annotationText?.trim()) {
      console.error(chalk.red("\n  No annotation text provided."))
      console.error(chalk.gray("  Usage: agentmind annotate <file> <text>\n"))
      process.exit(1)
    }
  }

  // Get priority
  const priorityInput = await prompt(
    `  Priority ${chalk.gray("(critical/high/normal/low)")} [normal]: `
  )
  const priority = validatePriority(priorityInput?.trim() || "normal")

  // Create annotation
  const annotation: Annotation = {
    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path: relativePath,
    line: lineNumber,
    text: annotationText.trim(),
    author: "user",
    created: Date.now(),
  }

  // Save to store
  const saveStore = new ContextStore(cwd)
  try {
    saveStore.addAnnotation(annotation)

    // Also save as meta for priority tracking
    saveStore.setMeta(
      `priority:${annotation.id}`,
      priority
    )
  } finally {
    saveStore.close()
  }

  // Export to JSONL
  const jsonlExportPath = path.join(agentmindDir, "context.jsonl")
  try {
    const entry = {
      id: annotation.id,
      path: relativePath,
      classification: "source" as const,
      rules: [],
      annotations: [annotation],
      behaviors: [],
      lastScanned: Date.now(),
      hash: "",
    }
    appendJSONL(jsonlExportPath, entry)
  } catch {
    // JSONL append failed - db is the source of truth
  }

  // Success output
  console.log("")
  console.log(
    chalk.green("  \u2713") +
      ` Annotation saved for ${chalk.cyan(relativePath)}` +
      (lineNumber ? chalk.gray(`:${lineNumber}`) : "")
  )
  console.log(chalk.gray(`    "${annotationText.trim()}"`))
  console.log(
    chalk.gray(`    Priority: ${priority}`)
  )
  console.log("")
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}
