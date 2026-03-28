import type { AdapterContext } from "./types.js"

export function renderRulesSections(ctx: AdapterContext): string {
  const lines: string[] = []

  const withRules = ctx.entries.filter(e => e.rules.length > 0)
  if (withRules.length > 0) {
    lines.push("## Rules", "")
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
    lines.push("## Annotations", "")
    for (const ann of annotations) {
      const loc = ann.line ? `:${ann.line}` : ""
      lines.push(`- ${ann.path}${loc}: ${ann.text}`)
    }
    lines.push("")
  }

  if (ctx.patterns.length > 0) {
    lines.push("## Non-obvious patterns", "")
    for (const p of ctx.patterns) {
      lines.push(`- ${p.path}: ${p.reason}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
