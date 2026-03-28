import { glob } from "glob";
import { ContextStore } from "../store/schema.js";
import type { Rule } from "../types/index.js";
import type { ContextTemplate, TemplateDetection } from "./registry.js";
import { nextjsTemplate } from "./nextjs.js";
import { sstTemplate } from "./sst.js";
import { reactNativeTemplate } from "./react-native.js";
import { pythonTemplate } from "./python.js";
import { goTemplate } from "./go.js";
import { rustTemplate } from "./rust.js";

const templates: ContextTemplate[] = [
  nextjsTemplate(),
  sstTemplate(),
  reactNativeTemplate(),
  pythonTemplate(),
  goTemplate(),
  rustTemplate(),
];

const detectionGlobs: TemplateDetection[] = [
  { name: "nextjs", detectGlob: "next.config.*" },
  { name: "sst", detectGlob: "sst.config.ts" },
  { name: "react-native", detectGlob: "app/**/_layout.tsx" },
  { name: "python", detectGlob: "pyproject.toml" },
  { name: "go", detectGlob: "go.mod" },
  { name: "rust", detectGlob: "Cargo.toml" },
];

export function listTemplates(): ContextTemplate[] {
  return templates;
}

export function getTemplate(name: string): ContextTemplate | undefined {
  return templates.find((t) => t.name === name);
}

export interface ApplyResult {
  rulesAdded: number;
  patternsMatched: number;
  skipped: string[];
}

/** Idempotent. Skipped patterns match zero files. */
export async function applyTemplate(
  templateName: string,
  projectRoot: string,
  store: ContextStore,
): Promise<ApplyResult> {
  const template = getTemplate(templateName);
  if (!template) {
    throw new Error(`Unknown template: ${templateName}`);
  }

  const result: ApplyResult = {
    rulesAdded: 0,
    patternsMatched: 0,
    skipped: [],
  };

  for (const rule of template.rules) {
    const matches = await glob(rule.pattern, { cwd: projectRoot, dot: true });

    if (matches.length === 0) {
      result.skipped.push(rule.pattern);
      continue;
    }

    result.patternsMatched += matches.length;

    for (const filePath of matches) {
      const normPath = filePath.replace(/\\/g, "/");

      if (isRuleDuplicate(store, normPath, rule.description)) {
        continue;
      }

      const storeRule: Rule = {
        id: `template-${templateName}-${normPath}`,
        path: normPath,
        pattern: rule.pattern,
        description: rule.description,
        priority: priorityToNumber(rule.priority),
      };

      store.addRule(storeRule);
      result.rulesAdded++;
    }
  }

  store.setMeta(`template:${templateName}`, new Date().toISOString());

  return result;
}

export async function autoApplyTemplates(
  projectRoot: string,
  store: ContextStore,
): Promise<Map<string, ApplyResult>> {
  const results = new Map<string, ApplyResult>();

  for (const detection of detectionGlobs) {
    const matches = await glob(detection.detectGlob, {
      cwd: projectRoot,
      dot: true,
    });

    if (matches.length > 0) {
      const applyResult = await applyTemplate(
        detection.name,
        projectRoot,
        store,
      );
      results.set(detection.name, applyResult);
    }
  }

  return results;
}

// Makes applyTemplate idempotent
function isRuleDuplicate(
  store: ContextStore,
  filePath: string,
  description: string,
): boolean {
  const existing = store.getEntries({ filePath, type: "rule" });
  return existing.some((entry) =>
    entry.rules.some((r) => r.description === description),
  );
}

function priorityToNumber(
  priority: "critical" | "high" | "normal" | "low",
): number {
  switch (priority) {
    case "critical":
      return 80;
    case "high":
      return 60;
    case "normal":
      return 30;
    case "low":
      return 10;
  }
}
