import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type { HookConfig } from "../types/index.js"
import { generatePreToolUseHook, generatePostToolUseHook, generatePostCommitHook } from "./template.js"

const HOOKS_DIR = ".agentlayer/hooks"
const SETTINGS_FILE = ".claude/settings.local.json"
const HOOK_MARKERS = ["pre-tool-use.mjs", "post-tool-use.mjs", "post-commit.mjs"]

interface ClaudeHook {
  matcher: string
  hooks: string[]
}

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: ClaudeHook[]
    PostToolUse?: ClaudeHook[]
    PostCommit?: ClaudeHook[]
  }
  [key: string]: unknown
}

function getAgentLayerBin(): string {
  if (process.env.AGENTLAYER_DEV) {
    return "agentlayer"
  }
  return "agentlayer"
}

function getHookScript(name: string): string {
  return path.join(HOOKS_DIR, `${name}.mjs`)
}

function getNodeHookCommand(name: string): string {
  return `node ${getHookScript(name)}`
}

function writeAgentLayerConfig(projectRoot: string): void {
  const cliEntry = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../cli/index.js",
  )
  const configPath = path.join(projectRoot, ".agentlayer", "config.json")
  const config = {
    command: [process.execPath, cliEntry],
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

export function getClaudeHookConfig(agentLayerBin: string): HookConfig[] {
  return [
    {
      agent: "claude",
      events: [{ type: "pre_prompt", filter: "Read|Edit|Write" }],
      script: getHookScript("pre-tool-use"),
      enabled: true,
    },
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
  ]
}

export function installClaudeHooks(projectRoot: string, agentLayerBin?: string): void {
  const hooksDir = path.join(projectRoot, HOOKS_DIR)

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true })
  }

  writeAgentLayerConfig(projectRoot)

  fs.writeFileSync(path.join(hooksDir, "pre-tool-use.mjs"), generatePreToolUseHook())
  fs.writeFileSync(path.join(hooksDir, "post-tool-use.mjs"), generatePostToolUseHook())
  fs.writeFileSync(path.join(hooksDir, "post-commit.mjs"), generatePostCommitHook())

  const settingsPath = path.join(projectRoot, SETTINGS_FILE)
  let settings: ClaudeSettings = {}

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    } catch {
      settings = {}
    }
  }

  if (!settings.hooks) {
    settings.hooks = {}
  }

  const preToolUseHook: ClaudeHook = {
    matcher: "Read|Edit|Write",
    hooks: [getNodeHookCommand("pre-tool-use")],
  }

  if (!settings.hooks.PreToolUse) {
    settings.hooks.PreToolUse = []
  }

  const existingPreIndex = settings.hooks.PreToolUse.findIndex(
    (h) => h.matcher === preToolUseHook.matcher && h.hooks.some((hook) => hook.includes("pre-tool-use.mjs"))
  )

  if (existingPreIndex === -1) {
    settings.hooks.PreToolUse.push(preToolUseHook)
  }

  const postToolUseHook: ClaudeHook = {
    matcher: "Edit|Write",
    hooks: [getNodeHookCommand("post-tool-use")],
  }

  if (!settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = []
  }

  const existingPostIndex = settings.hooks.PostToolUse.findIndex(
    (h) => h.matcher === postToolUseHook.matcher && h.hooks.some((hook) => hook.includes("post-tool-use.mjs"))
  )

  if (existingPostIndex === -1) {
    settings.hooks.PostToolUse.push(postToolUseHook)
  }

  const postCommitHook: ClaudeHook = {
    matcher: "*",
    hooks: [getNodeHookCommand("post-commit")],
  }

  if (!settings.hooks.PostCommit) {
    settings.hooks.PostCommit = []
  }

  const existingCommitIndex = settings.hooks.PostCommit.findIndex(
    (h) => h.matcher === postCommitHook.matcher && h.hooks.some((hook) => hook.includes("post-commit"))
  )

  if (existingCommitIndex === -1) {
    settings.hooks.PostCommit.push(postCommitHook)
  }

  const claudeDir = path.dirname(settingsPath)
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true })
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

// Preserves any other existing hooks.
export function uninstallClaudeHooks(projectRoot: string): void {
  const settingsPath = path.join(projectRoot, SETTINGS_FILE)

  if (!fs.existsSync(settingsPath)) {
    return
  }

  let settings: ClaudeSettings
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
  } catch {
    return
  }

  if (!settings.hooks) {
    return
  }

  if (settings.hooks.PreToolUse) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
      (h) => !h.hooks.some((hook) => hook.includes("agentlayer"))
      && !h.hooks.some((hook) => hook.includes("pre-tool-use.mjs"))
    )
    if (settings.hooks.PreToolUse.length === 0) {
      delete settings.hooks.PreToolUse
    }
  }

  if (settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
      (h) => !h.hooks.some((hook) => hook.includes("agentlayer"))
      && !h.hooks.some((hook) => hook.includes("post-tool-use.mjs"))
    )
    if (settings.hooks.PostToolUse.length === 0) {
      delete settings.hooks.PostToolUse
    }
  }

  if (settings.hooks.PostCommit) {
    settings.hooks.PostCommit = settings.hooks.PostCommit.filter(
      (h) => !h.hooks.some((hook) => hook.includes("agentlayer"))
      && !h.hooks.some((hook) => hook.includes("post-commit.mjs"))
    )
    if (settings.hooks.PostCommit.length === 0) {
      delete settings.hooks.PostCommit
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

  const hooksDir = path.join(projectRoot, HOOKS_DIR)
  if (fs.existsSync(hooksDir)) {
    const hookFiles = ["pre-tool-use.mjs", "post-tool-use.mjs", "post-commit.mjs"]
    for (const file of hookFiles) {
      const filePath = path.join(hooksDir, file)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }
    const remaining = fs.readdirSync(hooksDir)
    if (remaining.length === 0) {
      fs.rmdirSync(hooksDir)
    }
  }
}

export function isClaudeHooksInstalled(projectRoot: string): boolean {
  const hooksDir = path.join(projectRoot, HOOKS_DIR)
  const preHookPath = path.join(hooksDir, "pre-tool-use.mjs")

  if (!fs.existsSync(preHookPath)) {
    return false
  }

  const settingsPath = path.join(projectRoot, SETTINGS_FILE)
  if (!fs.existsSync(settingsPath)) {
    return false
  }

  try {
    const settings: ClaudeSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))

    if (!settings.hooks?.PreToolUse) {
      return false
    }

    return settings.hooks.PreToolUse.some((h) =>
      h.hooks.some((hook) => HOOK_MARKERS.some((marker) => hook.includes(marker)))
    )
  } catch {
    return false
  }
}
