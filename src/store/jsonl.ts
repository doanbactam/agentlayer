import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ContextEntry } from "../types/index.js";
import type { ContextStore } from "./schema.js";

export function exportJSONL(store: ContextStore): string {
  const db = store.getDb();
  const rows = db
    .prepare(
      "SELECT id, file_path, type, content, scope, priority, source, created_at FROM context_entries ORDER BY id",
    )
    .all() as JsonlRow[];

  return (
    rows
      .map((r) => {
        let content: unknown = {};
        try {
          content = JSON.parse(r.content);
        } catch {
          // Malformed JSON content - use empty object as fallback
          content = {};
        }
        return JSON.stringify({
          id: r.id,
          type: r.type,
          scope: r.scope,
          filePath: r.file_path,
          content,
          priority: r.priority,
          source: r.source,
          timestamp: r.created_at,
        });
      })
      .join("\n") + (rows.length > 0 ? "\n" : "")
  );
}

export function importJSONL(store: ContextStore, jsonl: string): void {
  const db = store.getDb();
  const existing = new Set(
    (
      db.prepare("SELECT id FROM context_entries").all() as { id: number }[]
    ).map((r) => r.id),
  );

  const insert = db.prepare(`
    INSERT INTO context_entries (id, file_path, type, content, scope, priority, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const lines = jsonl.split("\n").filter((l) => l.trim());
  const invalidLines: number[] = [];
  const tx = db.transaction(() => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        invalidLines.push(i + 1);
        continue;
      }
      if (existing.has(obj.id as number)) continue;
      insert.run(
        obj.id as number | null,
        (obj.filePath as string) ?? null,
        obj.type as string,
        JSON.stringify(obj.content),
        (obj.scope as string) ?? "global",
        (obj.priority as string) ?? "normal",
        (obj.source as string) ?? null,
        (obj.timestamp as string) ?? new Date().toISOString(),
      );
    }
  });
  tx();
  if (invalidLines.length > 0) {
    process.stderr.write(
      `[agentmind] Warning: Skipped ${invalidLines.length} malformed JSONL line(s) at line number(s): ${invalidLines.slice(0, 10).join(", ")}${invalidLines.length > 10 ? " ..." : ""}\n`,
    );
  }
}

export function appendJSONL(filepath: string, entry: ContextEntry): void {
  mkdirSync(dirname(filepath), { recursive: true });

  const chunks: string[] = [];

  const base = {
    id: entry.id,
    scope: "global" as const,
    filePath: entry.path,
    priority: "normal" as const,
    source: "auto" as const,
    timestamp: new Date(entry.lastScanned).toISOString(),
  };

  for (const r of entry.rules) {
    chunks.push(JSON.stringify({ ...base, type: "rule", content: r }));
  }
  for (const a of entry.annotations) {
    chunks.push(JSON.stringify({ ...base, type: "annotation", content: a }));
  }
  for (const b of entry.behaviors) {
    chunks.push(JSON.stringify({ ...base, type: "behavior", content: b }));
  }

  if (chunks.length === 0) {
    chunks.push(JSON.stringify({ ...base, type: "behavior", content: {} }));
  }

  appendFileSync(filepath, chunks.join("\n") + "\n", "utf-8");
}

interface JsonlRow {
  id: number;
  file_path: string | null;
  type: string;
  content: string;
  scope: string;
  priority: string;
  source: string | null;
  created_at: string;
}
