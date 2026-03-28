import { mkdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { SqliteDatabase } from "./db.js"
import type {
  Annotation,
  BehaviorEntry,
  ContextEntry,
  Rule,
  StoreHealth,
} from "../types/index.js"

const PRIORITY_THRESHOLDS = { critical: 80, high: 60, normal: 30 } as const

export class ContextStore {
  private db: SqliteDatabase
  private dbPath: string

  constructor(projectRoot: string) {
    this.dbPath = join(projectRoot, ".agentlayer", "context.db")
    mkdirSync(dirname(this.dbPath), { recursive: true })
    this.db = new SqliteDatabase(this.dbPath)
    this.db.pragma("journal_mode = WAL")
    this.init()
  }

  init(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS context_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT,
        type TEXT NOT NULL CHECK(type IN ('rule','annotation','behavior','convention')),
        content TEXT NOT NULL DEFAULT '{}',
        scope TEXT NOT NULL DEFAULT 'global',
        priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('critical','high','normal','low')),
        source TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS behavior_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_type TEXT NOT NULL,
        action TEXT NOT NULL,
        file_path TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
    this.db.run("CREATE INDEX IF NOT EXISTS idx_entries_file ON context_entries(file_path)")
    this.db.run("CREATE INDEX IF NOT EXISTS idx_entries_type ON context_entries(type)")
    this.db.run("CREATE INDEX IF NOT EXISTS idx_entries_scope ON context_entries(scope)")
    this.db.run("CREATE INDEX IF NOT EXISTS idx_entries_priority ON context_entries(priority)")
    this.db.run("CREATE INDEX IF NOT EXISTS idx_behaviors_agent ON behavior_log(agent_type)")
    this.db.run("CREATE INDEX IF NOT EXISTS idx_behaviors_file ON behavior_log(file_path)")
  }

  addRule(rule: Rule): void {
    const content = JSON.stringify(rule)
    const priorityLabel =
      rule.priority >= PRIORITY_THRESHOLDS.critical ? "critical"
      : rule.priority >= PRIORITY_THRESHOLDS.high ? "high"
      : rule.priority >= PRIORITY_THRESHOLDS.normal ? "normal"
      : "low"
    this.db.run(
      "INSERT INTO context_entries (file_path, type, content, scope, priority, source) VALUES (?, 'rule', ?, 'global', ?, 'scanner')",
      [rule.path ?? rule.pattern, content, priorityLabel]
    )
  }

  addAnnotation(annotation: Annotation): void {
    const content = JSON.stringify(annotation)
    this.db.run(
      "INSERT INTO context_entries (file_path, type, content, scope, priority, source) VALUES (?, 'annotation', ?, ?, 'normal', ?)",
      [
        annotation.path,
        content,
        annotation.line != null ? `line:${annotation.line}` : "global",
        annotation.author,
      ]
    )
  }

  replaceRules(source: string, rules: Rule[]): void {
    this.db.run("DELETE FROM context_entries WHERE type = 'rule' AND source = ?", [source])

    for (const rule of rules) {
      const content = JSON.stringify(rule)
      const priorityLabel =
        rule.priority >= PRIORITY_THRESHOLDS.critical ? "critical"
        : rule.priority >= PRIORITY_THRESHOLDS.high ? "high"
        : rule.priority >= PRIORITY_THRESHOLDS.normal ? "normal"
        : "low"

      this.db.run(
        "INSERT INTO context_entries (file_path, type, content, scope, priority, source) VALUES (?, 'rule', ?, 'global', ?, ?)",
        [rule.path ?? rule.pattern, content, priorityLabel, source]
      )
    }
  }

  getEntries(
    filter?: { filePath?: string; type?: string; scope?: string }
  ): ContextEntry[] {
    let sql = "SELECT * FROM context_entries WHERE 1=1"
    const params: (string | number)[] = []

    if (filter?.filePath) {
      sql += " AND file_path = ?"
      params.push(filter.filePath)
    }
    if (filter?.type) {
      sql += " AND type = ?"
      params.push(filter.type)
    }
    if (filter?.scope) {
      sql += " AND scope = ?"
      params.push(filter.scope)
    }

    sql += " ORDER BY CASE priority"
    sql += " WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END"
    sql += ", created_at DESC"

    const query = this.db.query(sql)
    const rows = query.all(...params) as Row[]
    return rows.map(rowToEntry)
  }

  logBehavior(entry: BehaviorEntry, success: boolean = true): void {
    const metadata = JSON.stringify({ pattern: entry.pattern, frequency: entry.frequency })
    this.db.run(
      "INSERT INTO behavior_log (agent_type, action, file_path, success, metadata) VALUES (?, ?, ?, ?, ?)",
      ["auto", entry.description, entry.path, success ? 1 : 0, metadata]
    )
  }

  getBehaviors(
    filter?: { agentType?: string; filePath?: string; success?: boolean }
  ): BehaviorEntry[] {
    let sql = "SELECT * FROM behavior_log WHERE 1=1"
    const params: (string | number)[] = []

    if (filter?.agentType) {
      sql += " AND agent_type = ?"
      params.push(filter.agentType)
    }
    if (filter?.filePath) {
      sql += " AND file_path = ?"
      params.push(filter.filePath)
    }
    if (filter?.success != null) {
      sql += " AND success = ?"
      params.push(filter.success ? 1 : 0)
    }

    sql += " ORDER BY timestamp DESC"

    const query = this.db.query(sql)
    const rows = query.all(...params) as BehaviorRow[]
    return rows.map((row) => ({
      id: String(row.id),
      path: row.file_path ?? "",
      pattern: "",
      description: row.action,
      frequency: 1,
      lastSeen: new Date(row.timestamp).getTime(),
    }))
  }

  queryContext(opts: { filePath?: string; taskDescription?: string }): ContextEntry[] {
    if (!opts.filePath) {
      return this.getEntries({ scope: "global" })
    }

    const escaped = escapeLike(opts.filePath)

    const query = this.db.query(`
      SELECT * FROM context_entries
      WHERE scope = 'global'
         OR file_path = ?
         OR (
           file_path LIKE '%' || substr(?, instr(?, '*')) || '%' ESCAPE '\\'
           AND scope = 'pattern'
         )
      ORDER BY CASE priority
        WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END
      , created_at DESC
    `)
    const rows = query.all(opts.filePath, escaped, escaped) as Row[]
    return rows.map(rowToEntry)
  }

  setMeta(key: string, value: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)",
      [key, value]
    )
  }

  getMeta(key: string): string | undefined {
    const query = this.db.query("SELECT value FROM project_meta WHERE key = ?")
    const row = query.get(key) as { value: string } | undefined
    return row?.value
  }

  getHealth(): StoreHealth {
    const entriesQuery = this.db.query("SELECT COUNT(*) as c FROM context_entries")
    const entries = entriesQuery.get() as { c: number }

    const staleQuery = this.db.query("SELECT COUNT(*) as c FROM context_entries WHERE updated_at < datetime('now', '-30 days')")
    const stale = staleQuery.get() as { c: number }

    const orphanedQuery = this.db.query(`
      SELECT COUNT(*) as c FROM context_entries
      WHERE type = 'rule'
      AND file_path IS NOT NULL
      AND file_path != ''
      AND file_path NOT IN (SELECT DISTINCT file_path FROM context_entries WHERE type = 'annotation')
    `)
    const orphaned = orphanedQuery.get() as { c: number }

    let dbSize = 0
    try {
      dbSize = statSync(this.dbPath).size
    } catch {}

    return {
      dbSize,
      entries: entries.c,
      staleEntries: stale.c,
      orphanedRules: orphaned.c,
    }
  }

  getDb(): SqliteDatabase {
    return this.db
  }

  close(): void {
    this.db.close()
  }
}

interface Row {
  id: number
  file_path: string | null
  type: string
  content: string
  scope: string
  priority: string
  source: string | null
  created_at: string
  updated_at: string
}

interface BehaviorRow {
  id: number
  agent_type: string
  action: string
  file_path: string | null
  success: number
  timestamp: string
  metadata: string
}

function escapeLike(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

function rowToEntry(row: Row): ContextEntry {
  const parsed = JSON.parse(row.content)
  return {
    id: String(row.id),
    path: row.file_path ?? "",
    classification: "source" as const,
    rules: row.type === "rule" ? [parsed] : [],
    annotations: row.type === "annotation" ? [parsed] : [],
    behaviors: row.type === "behavior" ? [parsed] : [],
    lastScanned: new Date(row.updated_at).getTime(),
    hash: "",
  }
}
