import { createSyncAdapter } from "./types.js"

export const cursor = createSyncAdapter("cursor", ".cursorrules", (ctx) => {
  const lines: string[] = []

  lines.push("# agentmind context (auto-generated — do not edit manually)")
  lines.push("# Run `agentmind sync --tool cursor` to update")
  lines.push("")

  const withRules = ctx.entries.filter(e => e.rules.length > 0)
  if (withRules.length > 0) {
    lines.push("## Rules")
    lines.push("")
    for (const entry of withRules) {
      for (const rule of entry.rules) {
        const source = rule.path ? `${rule.path}: ` : ""
        lines.push(`- ${source}${rule.description}`)
      }
    }
    lines.push("")
  }

  const annotations = ctx.entries.flatMap(e => e.annotations)
  if (annotations.length > 0) {
    lines.push("## Annotations")
    lines.push("")
    for (const ann of annotations) {
      const loc = ann.line ? `:${ann.line}` : ""
      lines.push(`- ${ann.path}${loc}: ${ann.text}`)
    }
    lines.push("")
  }

  if (ctx.patterns.length > 0) {
    lines.push("## Non-obvious patterns")
    lines.push("")
    for (const p of ctx.patterns) {
      lines.push(`- ${p.path}: ${p.reason}`)
    }
    lines.push("")
  }

  return lines.join("\n")
})
