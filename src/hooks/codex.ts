import * as fs from "node:fs";
import * as path from "node:path";
import type { HookConfig } from "../types/index.js";
import {
  getHookScript,
  getNodeHookCommand,
  writeAgentMindConfig,
  ensureHooksDir,
  writeHookScripts,
  removeHookScripts,
} from "./shared.js";

const CODEX_CONFIG_DIR = ".codex";
const CODEX_CONFIG_FILE = "config.json";

interface CodexConfig {
  hooks?: {
    preToolUse?: string;
    postToolUse?: string;
    onFileChange?: string;
  };
  [key: string]: unknown;
}

function readCodexConfig(configPath: string): CodexConfig {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

export function getCodexHookConfig(_agentMindBin: string): HookConfig[] {
  return [
    {
      agent: "codex",
      events: [{ type: "pre_prompt", filter: "read|edit|write" }],
      script: getHookScript("pre-tool-use"),
      enabled: true,
    },
    {
      agent: "codex",
      events: [{ type: "post_response", filter: "edit|write" }],
      script: getHookScript("post-tool-use"),
      enabled: true,
    },
  ];
}

export function installCodexHooks(projectRoot: string): void {
  const hooksDir = ensureHooksDir(projectRoot);
  writeAgentMindConfig(projectRoot);
  writeHookScripts(hooksDir);

  const codexDir = path.join(projectRoot, CODEX_CONFIG_DIR);
  if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });

  const configPath = path.join(codexDir, CODEX_CONFIG_FILE);
  const config = readCodexConfig(configPath);

  config.hooks = {
    preToolUse: getNodeHookCommand("pre-tool-use"),
    postToolUse: getNodeHookCommand("post-tool-use"),
    onFileChange: getNodeHookCommand("post-commit"),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function uninstallCodexHooks(projectRoot: string): void {
  const configPath = path.join(
    projectRoot,
    CODEX_CONFIG_DIR,
    CODEX_CONFIG_FILE,
  );
  if (!fs.existsSync(configPath)) return;

  let config: CodexConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return;
  }

  if (config.hooks) {
    delete config.hooks.preToolUse;
    delete config.hooks.postToolUse;
    delete config.hooks.onFileChange;
    if (Object.keys(config.hooks).length === 0) delete config.hooks;
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  removeHookScripts(projectRoot);
}

export function isCodexHooksInstalled(projectRoot: string): boolean {
  const configPath = path.join(
    projectRoot,
    CODEX_CONFIG_DIR,
    CODEX_CONFIG_FILE,
  );
  if (!fs.existsSync(configPath)) return false;

  try {
    const config: CodexConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8"),
    );
    return !!config.hooks?.preToolUse?.includes("pre-tool-use.mjs");
  } catch {
    return false;
  }
}
