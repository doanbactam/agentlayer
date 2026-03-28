import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ContextEntry, NonInferablePattern } from "../types/index.js";
import type { ContextStore } from "../store/schema.js";

export interface AdapterOutput {
  filename: string;
  content: string;
}

export interface AdapterContext {
  entries: ContextEntry[];
  patterns: NonInferablePattern[];
  projectName?: string;
}

export interface Adapter {
  name: string;
  filename: string;
  render(ctx: AdapterContext): string;
  sync(projectRoot: string, store: ContextStore): void;
  unsync(projectRoot: string): void;
  isInstalled(projectRoot: string): boolean;
}

export const SYNC_MARKER_START = "<!-- agentmind:sync -->";
export const SYNC_MARKER_END = "<!-- agentmind:endsync -->";

export function buildContext(store: ContextStore): AdapterContext {
  const entries = store.getEntries();
  // Patterns are from scanner detection, not duplicated from rules
  return { entries, patterns: [] };
}

export function createSyncAdapter(
  name: string,
  filename: string,
  render: Adapter["render"],
): Adapter {
  function sync(this: Adapter, projectRoot: string, store: ContextStore): void {
    const ctx = buildContext(store);
    const content = this.render(ctx);
    const filePath = join(projectRoot, this.filename);

    const block = `${SYNC_MARKER_START}\n${content}${SYNC_MARKER_END}`;

    if (!existsSync(filePath)) {
      writeFileSync(filePath, block + "\n");
      return;
    }

    const existing = readFileSync(filePath, "utf-8");

    if (existing.includes(SYNC_MARKER_START)) {
      const start = existing.indexOf(SYNC_MARKER_START);
      const end = existing.indexOf(SYNC_MARKER_END) + SYNC_MARKER_END.length;
      const updated = existing.slice(0, start) + block + existing.slice(end);
      writeFileSync(filePath, updated);
      return;
    }

    writeFileSync(filePath, existing.trimEnd() + "\n\n" + block + "\n");
  }

  function unsync(this: Adapter, projectRoot: string): void {
    const filePath = join(projectRoot, this.filename);
    if (!existsSync(filePath)) return;

    const existing = readFileSync(filePath, "utf-8");
    if (!existing.includes(SYNC_MARKER_START)) return;

    const start = existing.indexOf(SYNC_MARKER_START);
    const end = existing.indexOf(SYNC_MARKER_END) + SYNC_MARKER_END.length;

    const updated = (existing.slice(0, start) + existing.slice(end))
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();

    if (updated.length === 0) {
      unlinkSync(filePath);
    } else {
      writeFileSync(filePath, updated + "\n");
    }
  }

  function isInstalled(this: Adapter, projectRoot: string): boolean {
    const filePath = join(projectRoot, this.filename);
    if (!existsSync(filePath)) return false;
    return readFileSync(filePath, "utf-8").includes(SYNC_MARKER_START);
  }

  return { name, filename, render, sync, unsync, isInstalled };
}
