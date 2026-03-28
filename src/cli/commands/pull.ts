import chalk from "chalk";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ContextStore } from "../../store/schema.js";
import { importJSONL } from "../../store/jsonl.js";
import { isGitRepo } from "../utils.js";

export async function pull(opts: { force?: boolean }): Promise<void> {
  const root = process.cwd();
  const dbPath = join(root, ".agentmind", "context.db");
  const jsonlPath = join(root, ".agentmind", "context.jsonl");

  if (!existsSync(dbPath)) {
    console.error(
      chalk.red("\n  agentmind is not initialized in this project."),
    );
    console.error(chalk.gray("  Run `agentmind init` first.\n"));
    process.exit(1);
  }

  // git pull first if in a git repo
  if (isGitRepo(root)) {
    try {
      const out = execSync("git pull", { cwd: root, encoding: "utf-8" }).trim();
      console.log(chalk.dim(out || "Already up to date."));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message.split("\n")[0] : "git pull failed";
      console.log(chalk.yellow(`Git pull failed: ${msg}`));
      console.log(chalk.dim("Continuing with local context.jsonl..."));
    }
  }

  if (!existsSync(jsonlPath)) {
    console.log(chalk.yellow("No context JSONL found. Nothing to import."));
    return;
  }

  const jsonl = readFileSync(jsonlPath, "utf-8");
  if (!jsonl.trim()) {
    console.log(chalk.dim("Context JSONL is empty."));
    return;
  }

  const parsed = parseJsonlEntries(jsonl);
  if (parsed.validCount === 0) {
    console.log(
      chalk.red("Context JSONL contains no valid entries. Import aborted."),
    );
    return;
  }

  if (parsed.invalidCount > 0) {
    console.log(
      chalk.yellow(
        `Skipped ${parsed.invalidCount} malformed JSONL line${parsed.invalidCount !== 1 ? "s" : ""}.`,
      ),
    );
  }

  const store = new ContextStore(root);
  const db = store.getDb();

  const before = (
    db.query("SELECT COUNT(*) as c FROM context_entries").get() as { c: number }
  ).c;

  const incomingIds = parsed.ids;

  const existingIds = new Set(
    (db.query("SELECT id FROM context_entries").all() as { id: number }[]).map(
      (r) => r.id,
    ),
  );

  const skipped = incomingIds.filter((id) => existingIds.has(id)).length;
  const newCount = incomingIds.length - skipped;

  if (newCount === 0 && !opts.force) {
    console.log(chalk.green("Context is already in sync."));
    store.close();
    return;
  }

  let removed = 0;
  let imported = 0;

  if (opts.force) {
    removed = before;
    db.run("DELETE FROM context_entries");
    importJSONL(store, jsonl);
  } else {
    importJSONL(store, jsonl);
  }

  const after = (
    db.query("SELECT COUNT(*) as c FROM context_entries").get() as { c: number }
  ).c;
  imported = opts.force ? after : after - before;
  store.close();

  console.log(
    chalk.green(
      `Pulled ${imported > 0 ? imported : 0} new entries, ${skipped} existing, ${removed} removed`,
    ),
  );
  console.log(chalk.dim(`Local store: ${after} entries`));
}

function parseJsonlEntries(jsonl: string): {
  ids: number[];
  validCount: number;
  invalidCount: number;
} {
  const ids: number[] = [];
  let validCount = 0;
  let invalidCount = 0;

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { id?: unknown };
      validCount++;
      if (
        typeof parsed.id === "number" &&
        Number.isInteger(parsed.id) &&
        parsed.id >= 0
      ) {
        ids.push(parsed.id);
      }
    } catch {
      invalidCount++;
    }
  }

  return { ids, validCount, invalidCount };
}
