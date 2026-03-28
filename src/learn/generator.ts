import type { ContextStore } from "../store/schema.js";
import type { LearnedRule } from "./analyzer.js";
import type { Rule } from "../types/index.js";

export interface GeneratedRule {
  filePath: string;
  rule: Rule;
  confidence: number;
  source: "learned";
}

export function generateRules(learned: LearnedRule[]): GeneratedRule[] {
  return learned.map((l) => {
    const priority =
      l.suggestedPriority === "critical"
        ? 90
        : l.suggestedPriority === "high"
          ? 70
          : 40;

    return {
      filePath: l.filePath,
      rule: {
        id: `learned-${l.pattern}-${l.filePath.replace(/[^a-zA-Z0-9]/g, "_")}`,
        path: l.filePath,
        pattern: l.pattern,
        description: l.description,
        priority,
      },
      confidence: l.confidence,
      source: "learned" as const,
    };
  });
}

export function applyRules(
  store: ContextStore,
  rules: GeneratedRule[],
): number {
  const db = store.getDb();
  let applied = 0;

  for (const gr of rules) {
    const existing = db
      .query(
        "SELECT COUNT(*) as c FROM context_entries WHERE file_path = ? AND source = 'learned'",
      )
      .get(gr.filePath) as { c: number } | undefined;

    if (existing && existing.c > 0) continue;

    const content = JSON.stringify(gr.rule);
    const priorityLabel =
      gr.rule.priority >= 80
        ? "critical"
        : gr.rule.priority >= 60
          ? "high"
          : gr.rule.priority >= 30
            ? "normal"
            : "low";

    db.run(
      "INSERT INTO context_entries (file_path, type, content, scope, priority, source) VALUES (?, 'rule', ?, 'global', ?, 'learned')",
      [gr.filePath, content, priorityLabel],
    );
    applied++;
  }

  return applied;
}
