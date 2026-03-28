import { execSync } from "node:child_process"
import type { ScanResult, ContextEntry, Rule } from "../types/index.js"

export function formatContext(entries: ContextEntry[]): string {
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

  return lines.join("\n")
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function validatePriority(input: string): string {
  const valid = ["critical", "high", "normal", "low"]
  const lower = input.toLowerCase()
  return valid.includes(lower) ? lower : "normal"
}

export function isGitRepo(root: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: root, stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

export function buildEntries(result: ScanResult): ContextEntry[] {
  const entries: ContextEntry[] = []

  for (const file of result.files) {
    const normPath = file.path.replace(/\\/g, "/")
    const classification = result.classifications.get(file.path) ?? "source"
    const filePatterns = result.patterns.filter((p) => p.path.replace(/\\/g, "/") === normPath)

    const rules: Rule[] = filePatterns.map((p, i) => ({
      id: `rule-${normPath}-${i}`,
      path: normPath,
      pattern: p.pattern,
      description: p.reason,
      priority: 1,
    }))

    entries.push({
      id: `entry-${normPath}`,
      path: normPath,
      classification,
      rules,
      annotations: [],
      behaviors: [],
      lastScanned: result.timestamp,
      hash: file.hash,
    })
  }

  return entries
}
