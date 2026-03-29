import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { ContextStore } from "../../store/schema.js";
import { appendJSONL } from "../../store/jsonl.js";
import {
  collectProjectFiles,
  formatBytes as formatSize,
  validatePriority,
} from "../utils.js";
import type { Annotation, FileClassification } from "../../types/index.js";

interface FileGap {
  path: string;
  classification: FileClassification;
  size: number;
  rules: number;
  annotations: number;
  behaviors: number;
  hasFailures: boolean;
}

interface OverlayOptions {
  dir?: string;
  unclassified?: boolean;
  failed?: boolean;
  all?: boolean;
  json?: boolean;
}

export async function overlay(opts: OverlayOptions = {}) {
  const cwd = process.cwd();
  const agentmindDir = path.join(cwd, ".agentmind");

  if (!fs.existsSync(agentmindDir)) {
    console.error(
      chalk.red("\n  agentmind is not initialized in this project."),
    );
    console.error(chalk.gray("  Run `agentmind init` first.\n"));
    process.exit(1);
  }

  console.log("");
  console.log(chalk.dim("─").repeat(54));
  console.log(chalk.gray("  Scanning for context gaps..."));

  // Get all files from scanner
  const { files, classifications } = collectProjectFiles(cwd);

  // Get existing context from store
  const store = new ContextStore(cwd);
  const contextMap = new Map<
    string,
    {
      rules: number;
      annotations: number;
      behaviors: number;
      hasFailures: boolean;
    }
  >();

  try {
    const allEntries = store.getEntries();

    for (const entry of allEntries) {
      if (!entry.path) continue;
      const existing = contextMap.get(entry.path) || {
        rules: 0,
        annotations: 0,
        behaviors: 0,
        hasFailures: false,
      };
      existing.rules += entry.rules.length;
      existing.annotations += entry.annotations.length;
      existing.behaviors += entry.behaviors.length;
      contextMap.set(entry.path, existing);
    }

    // Check for failed behaviors per file
    const failedBehaviors = store.getBehaviors({ success: false });
    for (const b of failedBehaviors) {
      if (b.path) {
        const existing = contextMap.get(b.path) || {
          rules: 0,
          annotations: 0,
          behaviors: 0,
          hasFailures: false,
        };
        existing.hasFailures = true;
        contextMap.set(b.path, existing);
      }
    }
  } finally {
    store.close();
  }

  // Build list of gaps
  const gaps: FileGap[] = [];

  for (const file of files) {
    const classification = classifications.get(file.path) || "data";
    const context = contextMap.get(file.path) || {
      rules: 0,
      annotations: 0,
      behaviors: 0,
      hasFailures: false,
    };

    // Filter by directory if specified
    if (opts.dir) {
      const dirPattern = opts.dir
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/$/, "");
      if (!file.path.startsWith(dirPattern + "/") && file.path !== dirPattern) {
        continue;
      }
    }

    const hasContext =
      context.rules > 0 || context.annotations > 0 || context.behaviors > 0;

    // Apply filters
    if (opts.failed && !context.hasFailures) continue;
    if (opts.unclassified && hasContext) continue;
    if (!opts.all && !opts.unclassified && !opts.failed && hasContext) continue;

    gaps.push({
      path: file.path,
      classification,
      size: file.size,
      rules: context.rules,
      annotations: context.annotations,
      behaviors: context.behaviors,
      hasFailures: context.hasFailures,
    });
  }

  // Sort: source files first, then by path
  gaps.sort((a, b) => {
    if (a.classification === "source" && b.classification !== "source")
      return -1;
    if (a.classification !== "source" && b.classification === "source")
      return 1;
    return a.path.localeCompare(b.path);
  });

  // JSON output
  if (opts.json) {
    console.log(JSON.stringify(gaps, null, 2));
    return;
  }

  if (gaps.length === 0) {
    console.log("");
    console.log(chalk.green("  No context gaps found."));
    if (!opts.all) {
      console.log(chalk.gray("  Run with --all to see all files."));
    }
    console.log("");
    return;
  }

  console.log(
    chalk.gray(
      `  Found ${chalk.white(gaps.length)} file${gaps.length === 1 ? "" : ""}${opts.unclassified ? " without context" : ""}:`,
    ),
  );
  console.log("");

  // Track session progress
  let annotatedCount = 0;
  let skippedCount = 0;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (prompt: string): Promise<string> =>
    new Promise((res) => rl.question(prompt, (ans) => res(ans)));

  try {
    // Main loop
    while (gaps.length > 0) {
      displayFileList(gaps, annotatedCount);

      const selection = await question(
        `  Select a file to annotate (1-${gaps.length}) or 'q' to quit: `,
      );

      if (selection.trim().toLowerCase() === "q") {
        console.log("");
        console.log(
          chalk.gray(
            `  Session ended. ${chalk.white(annotatedCount)} annotated, ${chalk.white(skippedCount)} skipped.`,
          ),
        );
        console.log("");
        break;
      }

      const index = parseInt(selection, 10) - 1;
      if (isNaN(index) || index < 0 || index >= gaps.length) {
        console.log(chalk.yellow("\n  Invalid selection.\n"));
        continue;
      }

      const selected = gaps[index];

      // Show file detail and get annotation
      const result = await annotateFile(selected, cwd, rl, question);

      if (result === "quit") {
        console.log("");
        console.log(
          chalk.gray(
            `  Session ended. ${chalk.white(annotatedCount)} annotated, ${chalk.white(skippedCount)} skipped.`,
          ),
        );
        console.log("");
        break;
      }

      if (result === "annotated") {
        annotatedCount++;
        gaps.splice(index, 1);
      } else if (result === "skipped") {
        skippedCount++;
        gaps.splice(index, 1);
      }
    }

    if (gaps.length === 0 && (annotatedCount > 0 || skippedCount > 0)) {
      console.log("");
      console.log(chalk.green("  All files processed."));
      console.log(
        chalk.gray(
          `  Session: ${chalk.white(annotatedCount)} annotated, ${chalk.white(skippedCount)} skipped.`,
        ),
      );
      console.log("");
    }
  } finally {
    rl.close();
  }
}

function displayFileList(gaps: FileGap[], annotatedCount: number) {
  console.log(chalk.dim("─").repeat(54));
  if (annotatedCount > 0) {
    console.log(
      chalk.gray(
        `  Progress: ${chalk.white(annotatedCount)} annotated this session`,
      ),
    );
    console.log("");
  }

  const displayCount = Math.min(gaps.length, 10);
  for (let i = 0; i < displayCount; i++) {
    const gap = gaps[i];
    const num = chalk.gray(`${String(i + 1).padStart(2)}.`);
    const clsColor = classificationColor(gap.classification);
    const sizeStr = formatSize(gap.size);

    let contextStr = "";
    if (gap.rules > 0 || gap.annotations > 0) {
      contextStr = chalk.gray(` - ${gap.rules}r, ${gap.annotations}a`);
    } else {
      contextStr = chalk.gray(" - 0 rules, 0 annotations");
    }

    if (gap.hasFailures) {
      contextStr += chalk.red(" !failures");
    }

    console.log(
      `  ${num} ${clsColor(gap.path.padEnd(32))} ${chalk.gray(sizeStr)}${contextStr}`,
    );
  }

  if (gaps.length > displayCount) {
    console.log(chalk.gray(`  ... and ${gaps.length - displayCount} more`));
  }

  console.log("");
}

async function annotateFile(
  gap: FileGap,
  cwd: string,
  rl: readline.Interface,
  question: (prompt: string) => Promise<string>,
): Promise<"annotated" | "skipped" | "quit"> {
  console.log("");
  console.log(chalk.dim("─").repeat(54));
  console.log(chalk.cyan.bold(`  ${gap.path}`));
  console.log(chalk.dim("─").repeat(54));
  console.log("");

  // File info
  console.log(
    `  Classification: ${classificationColor(gap.classification)(gap.classification)}`,
  );
  console.log(`  Size:           ${chalk.gray(formatSize(gap.size))}`);

  const hasContext = gap.rules > 0 || gap.annotations > 0 || gap.behaviors > 0;
  console.log(
    `  Existing context: ${hasContext ? chalk.yellow("partial") : chalk.gray("none")}`,
  );

  // Detect patterns in file
  const patterns = await detectFilePatterns(gap.path, cwd);
  if (patterns.length > 0) {
    console.log("");
    console.log(chalk.gray("  Detected patterns:"));
    for (const p of patterns.slice(0, 5)) {
      console.log(`    ${chalk.gray("-")} ${p}`);
    }
  }

  console.log("");

  // Get annotation text
  const annotationText = await question(
    "  Enter annotation (or 's' to skip, 'q' to quit):\n  > ",
  );

  if (annotationText.trim().toLowerCase() === "q") {
    return "quit";
  }

  if (annotationText.trim().toLowerCase() === "s" || !annotationText.trim()) {
    console.log(chalk.gray("\n  Skipped.\n"));
    return "skipped";
  }

  // Get priority
  const priorityInput = await question(
    `  Priority ${chalk.gray("(critical/high/normal/low)")} [normal]: `,
  );
  const priority = validatePriority(priorityInput.trim() || "normal");

  // Save annotation
  const annotation: Annotation = {
    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path: gap.path,
    text: annotationText.trim(),
    author: "user",
    created: Date.now(),
  };

  const saveStore = new ContextStore(cwd);
  try {
    saveStore.addAnnotation(annotation);
    saveStore.setMeta(`priority:${annotation.id}`, priority);
  } finally {
    saveStore.close();
  }

  // Append to JSONL
  try {
    const jsonlPath = path.join(cwd, ".agentmind", "context.jsonl");
    appendJSONL(jsonlPath, {
      id: annotation.id,
      path: gap.path,
      classification: "source" as const,
      rules: [],
      annotations: [annotation],
      behaviors: [],
      lastScanned: Date.now(),
      hash: "",
    });
  } catch {
    // JSONL append failed - db is the source of truth
  }

  console.log("");
  console.log(
    chalk.green("  Annotation saved for") + " " + chalk.cyan(gap.path),
  );
  console.log("");

  return "annotated";
}

async function detectFilePatterns(
  filePath: string,
  cwd: string,
): Promise<string[]> {
  const patterns: string[] = [];
  const fullPath = path.join(cwd, filePath);

  try {
    const content = await fs.promises.readFile(fullPath, "utf-8");

    // Pattern detectors
    if (/process\.cwd\(\)/.test(content)) {
      patterns.push("References process.cwd()");
    }
    if (
      /require\(['"]fs['"]\)/.test(content) ||
      /from\s+['"]node:fs['"]/.test(content) ||
      /import.*['"]fs['"]/.test(content)
    ) {
      patterns.push("Uses fs module heavily");
    }
    if (/child_process/.test(content)) {
      patterns.push("Spawns child processes");
    }
    if (/process\.env/.test(content)) {
      const envMatches = content.match(/process\.env\.(\w+)/g);
      if (envMatches) {
        const vars = [
          ...new Set(envMatches.map((m) => m.replace("process.env.", ""))),
        ].slice(0, 4);
        patterns.push(`Uses env vars: ${vars.join(", ")}`);
      }
    }
    if (/async\s+\w+\s*\(|async\s*\(/.test(content)) {
      const asyncCount = (content.match(/async\s+\w+\s*\(/g) || []).length;
      if (asyncCount >= 3) {
        patterns.push(`${asyncCount} async functions`);
      }
    }
    if (
      /export\s+(default\s+)?function|export\s+(default\s+)?class|export\s+const/.test(
        content,
      )
    ) {
      const exportCount = (
        content.match(/export\s+(default\s+)?(function|class|const)/g) || []
      ).length;
      if (exportCount >= 3) {
        patterns.push(`${exportCount} exports`);
      }
    }
  } catch {
    // File read failed, skip patterns
  }

  return patterns;
}

function classificationColor(
  cls: FileClassification,
): (text: string) => string {
  switch (cls) {
    case "source":
      return chalk.cyan;
    case "config":
      return chalk.yellow;
    case "test":
      return chalk.green;
    case "docs":
      return chalk.blue;
    case "data":
      return chalk.magenta;
    default:
      return chalk.gray;
  }
}
