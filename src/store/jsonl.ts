import { mkdirSync, appendFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { ContextEntry } from "../types/index.js"
import type { ContextStore } from "./schema.js"

export function exportJSONL(store: ContextStore): string {
  const db = store.getDb()
  const rows = db.prepare(
    "SELECT id, file_path, type, content, scope, priority, source, created_at FROM context_entries ORDER BY id"
  ).all() as JsonlRow[]

  return rows.map((r) => JSON.stringify({
    id: r.id,
    type: r.type,
    scope: r.scope,
    filePath: r.file_path,
    content: JSON.parse(r.content),
    priority: r.priority,
    source: r.source,
    timestamp: r.created_at,
  })).join("\n") + (rows.length > 0 ? "\n" : "")
}

export function importJSONL(store: ContextStore, jsonl: string): void {
  const db = store.getDb()
  const existing = new Set(
    (db.prepare("SELECT id FROM context_entries").all() as { id: number }[]).map((r) => r.id)
  )

  const insert = db.prepare(`
    INSERT INTO context_entries (id, file_path, type, content, scope, priority, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const lines = jsonl.split("\n").filter((l) => l.trim())
  const tx = db.transaction(() => {
    for (const line of lines) {
      let obj: Record<string, unknown>
      try { obj = JSON.parse(line) } catch { continue }
      if (existing.has(obj.id as number)) continue
      insert.run(
        obj.id as number | null,
        (obj.filePath as string) ?? null,
        obj.type as string,
        JSON.stringify(obj.content),
        (obj.scope as string) ?? "global",
        (obj.priority as string) ?? "normal",
        (obj.source as string) ?? null,
        (obj.timestamp as string) ?? new Date().toISOString()
      )
    }
  })
  tx()
}

export function appendJSONL(filepath: string, entry: ContextEntry): void {
  mkdirSync(dirname(filepath), { recursive: true })
  const line = JSON.stringify({
    id: entry.id,
    type: entry.rules.length > 0 ? "rule" : entry.annotations.length > 0 ? "annotation" : "behavior",
    scope: "global",
    filePath: entry.path,
    content: entry.rules[0] ?? entry.annotations[0] ?? entry.behaviors[0] ?? {},
    priority: "normal",
    source: "auto",
    timestamp: new Date(entry.lastScanned).toISOString(),
  }) + "\n"
  appendFileSync(filepath, line, "utf-8")
}

interface JsonlRow {
  id: number
  file_path: string | null
  type: string
  content: string
  scope: string
  priority: string
  source: string | null
  created_at: string
}
