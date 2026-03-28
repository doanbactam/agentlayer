import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generatePreToolUseHook,
  generatePostToolUseHook,
  generatePostCommitHook,
} from "./template.js";

const HOOKS_DIR = ".agentmind/hooks";
const HOOK_FILES = ["pre-tool-use.mjs", "post-tool-use.mjs", "post-commit.mjs"];

export function getHookScript(name: string): string {
  return path.join(HOOKS_DIR, `${name}.mjs`);
}

export function getNodeHookCommand(name: string): string {
  return `node ${getHookScript(name)}`;
}

export function writeAgentMindConfig(projectRoot: string): void {
  const cliEntry = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../cli/index.js",
  );
  const configPath = path.join(projectRoot, ".agentmind", "config.json");

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({ command: [process.execPath, cliEntry] }, null, 2),
  );
}

export function ensureHooksDir(projectRoot: string): string {
  const hooksDir = path.join(projectRoot, HOOKS_DIR);
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }
  return hooksDir;
}

export function writeHookScripts(hooksDir: string): void {
  fs.writeFileSync(
    path.join(hooksDir, "pre-tool-use.mjs"),
    generatePreToolUseHook(),
  );
  fs.writeFileSync(
    path.join(hooksDir, "post-tool-use.mjs"),
    generatePostToolUseHook(),
  );
  fs.writeFileSync(
    path.join(hooksDir, "post-commit.mjs"),
    generatePostCommitHook(),
  );
}

export function removeHookScripts(projectRoot: string): void {
  const hooksDir = path.join(projectRoot, HOOKS_DIR);
  if (!fs.existsSync(hooksDir)) return;
  for (const file of HOOK_FILES) {
    const filePath = path.join(hooksDir, file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  const remaining = fs.readdirSync(hooksDir);
  if (remaining.length === 0) fs.rmdirSync(hooksDir);
}
