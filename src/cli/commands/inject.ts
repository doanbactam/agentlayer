import * as fs from "node:fs"
import * as path from "node:path"
import { ContextStore } from "../../store/index.js"
import { route } from "../../router/index.js"
import type { ContextEntry } from "../../types/index.js"

interface InjectOptions {
  file?: string
}

export async function inject(query?: string, options?: InjectOptions): Promise<void> {
  const projectRoot = process.cwd()
  const storePath = path.join(projectRoot, ".agentmind", "context.db")

  if (!fs.existsSync(storePath)) {
    process.exit(0)
  }

  const store = new ContextStore(projectRoot)

  try {
    if (options?.file) {
      const entries = store.queryContext({ filePath: options.file })

      if (entries.length === 0) {
        process.exit(0)
      }

      outputContext(entries)
      return
    }

    if (query) {
      const allEntries = store.getEntries()
      let relevant: ContextEntry[]
      try {
        relevant = route(query, allEntries)
      } catch {
        relevant = allEntries
      }

      if (relevant.length === 0) {
        process.exit(0)
      }

      outputContext(relevant)
      return
    }

    process.exit(0)
  } finally {
    store.close()
  }
}

function outputContext(entries: ContextEntry[]): void {
  if (entries.length === 0) {
    return
  }

  const lines: string[] = [
    "# Agentmind Context",
    "",
    "Relevant context from the project knowledge base:",
    "",
  ]

  for (const e of entries) {
    lines.push(`## ${e.path}`)
    lines.push("")

    if (e.classification) {
      lines.push(`Classification: ${e.classification}`)
      lines.push("")
    }

    if (e.annotations.length > 0) {
      lines.push("### Annotations")
      for (const a of e.annotations) {
        const lineRef = a.line ? ` (line ${a.line})` : ""
        lines.push(`- ${a.text}${lineRef}`)
      }
      lines.push("")
    }

    if (e.rules.length > 0) {
      lines.push("### Rules")
      for (const r of e.rules) {
        lines.push(`- ${r.pattern}: ${r.description}`)
      }
      lines.push("")
    }

    if (e.behaviors.length > 0) {
      lines.push("### Observed Patterns")
      for (const b of e.behaviors) {
        lines.push(`- ${b.pattern}: ${b.description} (${b.frequency}x)`)
      }
      lines.push("")
    }
  }

  console.log(lines.join("\n"))
}
