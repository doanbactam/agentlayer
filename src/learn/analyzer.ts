import type { SqliteDatabase } from "../store/db.js"
import type { ContextStore } from "../store/schema.js"

export interface LearnedRule {
  filePath: string
  pattern: "frequent-failure" | "retry-loop" | "tool-mismatch" | "success-pattern" | "time-pattern"
  description: string
  confidence: number
  evidence: string[]
  suggestedPriority: "critical" | "high" | "normal"
}

export function analyzeBehaviors(store: ContextStore): LearnedRule[] {
  const db = store.getDb()
  const totalRow = db.query("SELECT COUNT(*) as c FROM behavior_log").get() as { c: number }
  if (totalRow.c === 0) return []

  const rules: LearnedRule[] = []
  rules.push(...findFrequentFailures(db))
  rules.push(...findRetryLoops(db))
  rules.push(...findToolMismatches(db))
  rules.push(...findSuccessPatterns(db))
  rules.push(...findTimePatterns(db))

  return rules
}

function findFrequentFailures(db: SqliteDatabase): LearnedRule[] {
  const rows = db.query(`
    SELECT file_path, COUNT(*) as failures
    FROM behavior_log
    WHERE success = 0 AND file_path IS NOT NULL AND file_path != ''
    GROUP BY file_path
    HAVING failures >= 2
    ORDER BY failures DESC
  `).all() as Array<{ file_path: string; failures: number }>

  return rows.map((r) => {
    const evidenceRows = db.query(
      "SELECT id FROM behavior_log WHERE success = 0 AND file_path = ? ORDER BY timestamp DESC LIMIT 10"
    ).all(r.file_path) as Array<{ id: number }>

    const confidence = Math.min(0.95, 0.5 + r.failures * 0.1)
    const priority: LearnedRule["suggestedPriority"] =
      r.failures >= 5 ? "critical" : r.failures >= 3 ? "high" : "normal"

    return {
      filePath: r.file_path,
      pattern: "frequent-failure" as const,
      description: `Agent fails frequently when editing this file (${r.failures} failures) — add annotation with guidance`,
      confidence,
      evidence: evidenceRows.map((e) => String(e.id)),
      suggestedPriority: priority,
    }
  })
}

function findRetryLoops(db: SqliteDatabase): LearnedRule[] {
  const rows = db.query(`
    SELECT file_path, COUNT(*) as edits, MIN(timestamp) as first_edit, MAX(timestamp) as last_edit
    FROM behavior_log
    WHERE file_path IS NOT NULL AND file_path != ''
    GROUP BY file_path
    HAVING edits >= 3
    ORDER BY edits DESC
  `).all() as Array<{ file_path: string; edits: number; first_edit: string; last_edit: string }>

  const rules: LearnedRule[] = []

  for (const r of rows) {
    const first = new Date(r.first_edit).getTime()
    const last = new Date(r.last_edit).getTime()
    const spanMin = (last - first) / 60000

    if (spanMin <= 30 && r.edits >= 3) {
      const evidenceRows = db.query(
        "SELECT id FROM behavior_log WHERE file_path = ? ORDER BY timestamp DESC LIMIT 10"
      ).all(r.file_path) as Array<{ id: number }>

      const confidence = Math.min(0.9, 0.4 + r.edits * 0.1)

      rules.push({
        filePath: r.file_path,
        pattern: "retry-loop",
        description: `Agent retried edits ${r.edits} times in ${Math.round(spanMin)} min — file may need clarification or simpler structure`,
        confidence,
        evidence: evidenceRows.map((e) => String(e.id)),
        suggestedPriority: r.edits >= 5 ? "high" : "normal",
      })
    }
  }

  return rules
}

function findToolMismatches(db: SqliteDatabase): LearnedRule[] {
  const rows = db.query(`
    SELECT file_path, action, COUNT(*) as failures
    FROM behavior_log
    WHERE success = 0 AND file_path IS NOT NULL AND file_path != ''
    GROUP BY file_path, action
    HAVING failures >= 2
    ORDER BY failures DESC
  `).all() as Array<{ file_path: string; action: string; failures: number }>

  const rules: LearnedRule[] = []

  for (const r of rows) {
    if (r.action.startsWith("tool:")) {
      const tool = r.action.replace("tool:", "")
      const ext = r.file_path.split(".").pop()?.toLowerCase() ?? ""
      const binaryExts = ["png", "jpg", "jpeg", "gif", "ico", "svg", "webp", "mp3", "mp4", "zip", "gz", "tar", "woff", "woff2", "ttf", "eot", "pdf"]

      if (binaryExts.includes(ext) && (tool === "Edit" || tool === "edit")) {
        const evidenceRows = db.query(
          "SELECT id FROM behavior_log WHERE success = 0 AND file_path = ? AND action = ? ORDER BY timestamp DESC LIMIT 10"
        ).all(r.file_path, r.action) as Array<{ id: number }>

        rules.push({
          filePath: r.file_path,
          pattern: "tool-mismatch",
          description: `Agent uses Edit on binary file (.${ext}) — use Write or shell commands instead`,
          confidence: 0.85,
          evidence: evidenceRows.map((e) => String(e.id)),
          suggestedPriority: "high",
        })
      }
    }
  }

  return rules
}

function findSuccessPatterns(db: SqliteDatabase): LearnedRule[] {
  const rows = db.query(`
    SELECT
      file_path,
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
    FROM behavior_log
    WHERE file_path IS NOT NULL AND file_path != ''
    GROUP BY file_path
    HAVING total >= 3 AND successes = total
    ORDER BY total DESC
  `).all() as Array<{ file_path: string; total: number; successes: number }>

  return rows.map((r) => {
    const evidenceRows = db.query(
      "SELECT id FROM behavior_log WHERE file_path = ? ORDER BY timestamp DESC LIMIT 5"
    ).all(r.file_path) as Array<{ id: number }>

    return {
      filePath: r.file_path,
      pattern: "success-pattern" as const,
      description: `Agent handles this file perfectly (${r.total}/${r.total} successes) — well-documented or straightforward`,
      confidence: Math.min(0.95, 0.5 + r.total * 0.05),
      evidence: evidenceRows.map((e) => String(e.id)),
      suggestedPriority: "normal" as const,
    }
  })
}

function findTimePatterns(db: SqliteDatabase): LearnedRule[] {
  const rows = db.query(`
    SELECT file_path,
      CAST(strftime('%H', timestamp) AS INTEGER) as hour,
      COUNT(*) as failures
    FROM behavior_log
    WHERE success = 0 AND file_path IS NOT NULL AND file_path != ''
    GROUP BY file_path, hour
    HAVING failures >= 2
    ORDER BY failures DESC
  `).all() as Array<{ file_path: string; hour: number; failures: number }>

  const rules: LearnedRule[] = []

  for (const r of rows) {
    const evidenceRows = db.query(
      "SELECT id FROM behavior_log WHERE success = 0 AND file_path = ? AND CAST(strftime('%H', timestamp) AS INTEGER) = ? LIMIT 5"
    ).all(r.file_path, r.hour) as Array<{ id: number }>

    rules.push({
      filePath: r.file_path,
      pattern: "time-pattern",
      description: `Failures cluster around ${r.hour}:00 — possibly related to CI queue or external service load`,
      confidence: 0.35,
      evidence: evidenceRows.map((e) => String(e.id)),
      suggestedPriority: "normal",
    })
  }

  return rules
}
