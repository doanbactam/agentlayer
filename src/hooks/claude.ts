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

const SETTINGS_FILE = ".claude/settings.local.json";
const HOOK_MARKERS = ["post-tool-use.mjs", "post-commit.mjs"];

interface ClaudeHook {
  matcher: string;
  hooks: string[];
}

interface ClaudeSettings {
  hooks?: {
    PostToolUse?: ClaudeHook[];
    PostCommit?: ClaudeHook[];
  };
  [key: string]: unknown;
}

function readClaudeSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return {};
  }
}

function upsertHook(list: ClaudeHook[], hook: ClaudeHook): void {
  const file = hook.hooks[0].split("/").pop() ?? "";
  const idx = list.findIndex(
    (h) =>
      h.matcher === hook.matcher && h.hooks.some((cmd) => cmd.includes(file)),
  );
  if (idx === -1) list.push(hook);
}

export function getClaudeHookConfig(_agentMindBin: string): HookConfig[] {
  return [
    {
      agent: "claude",
      events: [{ type: "post_response", filter: "Edit|Write" }],
      script: getHookScript("post-tool-use"),
      enabled: true,
    },
    {
      agent: "claude",
      events: [{ type: "on_file_change" }],
      script: getHookScript("post-commit"),
      enabled: true,
    },
  ];
}

export function installClaudeHooks(projectRoot: string): void {
  const hooksDir = ensureHooksDir(projectRoot);
  writeAgentMindConfig(projectRoot);
  writeHookScripts(hooksDir);

  const settingsPath = path.join(projectRoot, SETTINGS_FILE);
  const settings = readClaudeSettings(settingsPath);
  if (!settings.hooks) settings.hooks = {};

  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
  upsertHook(settings.hooks.PostToolUse, {
    matcher: "Edit|Write",
    hooks: [getNodeHookCommand("post-tool-use")],
  });

  if (!settings.hooks.PostCommit) settings.hooks.PostCommit = [];
  upsertHook(settings.hooks.PostCommit, {
    matcher: "*",
    hooks: [getNodeHookCommand("post-commit")],
  });

  const claudeDir = path.dirname(settingsPath);
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function filterAgentmindHooks(list: ClaudeHook[]): ClaudeHook[] {
  return list.filter(
    (h) =>
      !h.hooks.some(
        (hook) =>
          hook.includes("agentmind") ||
          HOOK_MARKERS.some((m) => hook.includes(m)),
      ),
  );
}

export function uninstallClaudeHooks(projectRoot: string): void {
  const settingsPath = path.join(projectRoot, SETTINGS_FILE);
  if (!fs.existsSync(settingsPath)) return;

  let settings: ClaudeSettings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return;
  }

  if (!settings.hooks) return;

  for (const key of ["PostToolUse", "PostCommit"] as const) {
    if (!settings.hooks[key]) continue;
    settings.hooks[key] = filterAgentmindHooks(settings.hooks[key]);
    if (settings.hooks[key]!.length === 0) delete settings.hooks[key];
  }

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  removeHookScripts(projectRoot);
}

export function isClaudeHooksInstalled(projectRoot: string): boolean {
  const hooksDir = path.join(projectRoot, ".agentmind/hooks");
  if (!fs.existsSync(path.join(hooksDir, "post-tool-use.mjs"))) return false;

  const settingsPath = path.join(projectRoot, SETTINGS_FILE);
  try {
    const settings: ClaudeSettings = JSON.parse(
      fs.readFileSync(settingsPath, "utf-8"),
    );
    return (
      settings.hooks?.PostToolUse?.some((h) =>
        h.hooks.some((hook) => HOOK_MARKERS.some((m) => hook.includes(m))),
      ) ?? false
    );
  } catch {
    return false;
  }
}
