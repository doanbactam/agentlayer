import chalk from "chalk";
import ora from "ora";
import fs from "node:fs";
import path from "node:path";
import { scan as runFullScan } from "../../scanner/index.js";
import { ContextStore } from "../../store/schema.js";
import { exportJSONL } from "../../store/jsonl.js";
import { buildEntries } from "../utils.js";
import type { ScanResult, ContextEntry, Rule } from "../../types/index.js";

export async function scan(opts: { force?: boolean; json?: boolean }) {
  const cwd = process.cwd();
  const agentmindDir = path.join(cwd, ".agentmind");
  const dbPath = path.join(agentmindDir, "context.db");
  const jsonlPath = path.join(agentmindDir, "context.jsonl");

  if (!fs.existsSync(agentmindDir)) {
    console.error(
      chalk.red("\n  agentmind is not initialized in this project."),
    );
    console.error(chalk.gray("  Run `agentmind init` first.\n"));
    process.exit(1);
  }

  // Load existing entries for diff
  const existingEntries = loadExistingEntries(jsonlPath);

  // Run scan
  const spinner = ora("Scanning project...").start();

  let result: ScanResult;
  try {
    result = await runFullScan(cwd);
    spinner.succeed(
      `Scan complete (${result.files.length} files, ${result.duration}ms)`,
    );
  } catch (err) {
    spinner.fail("Scan failed");
    console.error(
      chalk.red(
        `\n  ${err instanceof Error ? err.message : "Unknown error"}\n`,
      ),
    );
    process.exit(1);
  }

  // Build new entries — only for files with patterns (non-inferable)
  const newEntries = buildEntries(result).filter((e) => e.rules.length > 0);

  // Diff
  const diff = computeDiff(existingEntries, newEntries);

  // Update store
  const hasChanges =
    diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0;
  if (hasChanges) {
    const store = new ContextStore(cwd);
    try {
      store.replaceRules(
        "scanner",
        newEntries.flatMap((entry) => entry.rules),
      );

      // Export updated JSONL
      const jsonl = exportJSONL(store);
      fs.writeFileSync(jsonlPath, jsonl, "utf-8");
    } finally {
      store.close();
    }
  }

  // Output
  if (opts.json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  console.log("");

  if (
    diff.added.length === 0 &&
    diff.changed.length === 0 &&
    diff.removed.length === 0
  ) {
    console.log(
      chalk.green("  \u2713") + " No changes detected. Context is up to date.",
    );
  } else {
    if (diff.added.length > 0) {
      console.log(
        chalk.green("  +") +
          ` ${chalk.bold(diff.added.length)} new file${diff.added.length !== 1 ? "s" : ""}`,
      );
    }
    if (diff.changed.length > 0) {
      console.log(
        chalk.yellow("  ~") +
          ` ${chalk.bold(diff.changed.length)} changed file${diff.changed.length !== 1 ? "s" : ""}`,
      );
    }
    if (diff.removed.length > 0) {
      console.log(
        chalk.red("  -") +
          ` ${chalk.bold(diff.removed.length)} removed file${diff.removed.length !== 1 ? "s" : ""}`,
      );
    }
  }

  if (result.patterns.length > 0) {
    console.log(
      chalk.cyan("  i") +
        ` ${result.patterns.length} non-inferable pattern${result.patterns.length !== 1 ? "s" : ""} detected`,
    );
  }

  console.log("");
}

interface DiffResult {
  added: ContextEntry[];
  changed: ContextEntry[];
  removed: { path: string }[];
}

interface JsonlEntry {
  filePath: string;
  type: string;
  content: unknown;
}

interface ExistingEntrySummary {
  fingerprint: string;
}

function loadExistingEntries(
  jsonlPath: string,
): Map<string, ExistingEntrySummary> {
  const grouped = new Map<string, string[]>();

  if (!fs.existsSync(jsonlPath)) return new Map();

  const content = fs.readFileSync(jsonlPath, "utf-8");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as JsonlEntry;
      if (!entry.filePath || entry.type !== "rule") continue;
      const bucket = grouped.get(entry.filePath) ?? [];
      bucket.push(JSON.stringify(entry.content));
      grouped.set(entry.filePath, bucket);
    } catch {
      // Skip malformed lines
    }
  }

  const entries = new Map<string, ExistingEntrySummary>();
  for (const [filePath, fingerprints] of grouped) {
    entries.set(filePath, { fingerprint: fingerprints.sort().join("\n") });
  }

  return entries;
}

function computeDiff(
  existing: Map<string, ExistingEntrySummary>,
  updated: ContextEntry[],
): DiffResult {
  const added: ContextEntry[] = [];
  const changed: ContextEntry[] = [];
  const removed: { path: string }[] = [];

  const newPaths = new Set<string>();

  for (const entry of updated) {
    newPaths.add(entry.path);
    const prev = existing.get(entry.path);
    if (!prev) {
      added.push(entry);
    } else {
      const nextFingerprint = entry.rules
        .map((rule) => JSON.stringify(rule))
        .sort()
        .join("\n");

      if (prev.fingerprint !== nextFingerprint) {
        changed.push(entry);
      }
    }
  }

  for (const [filePath] of existing) {
    if (!newPaths.has(filePath)) {
      removed.push({ path: filePath });
    }
  }

  return { added, changed, removed };
}
