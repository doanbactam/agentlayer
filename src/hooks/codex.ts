import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type { HookConfig } from "../types/index.js"
import { generatePreToolUseHook, generatePostToolUseHook, generatePostCommitHook } from "./template.js"

const HOOKS_DIR = ".agentmind/hooks"
const CODEX_CONFIG_DIR = ".codex"
const CODEX_CONFIG_FILE = "config.json"

interface CodexConfig {
  hooks?: {
    preToolUse?: string
    postToolUse?: string
    onFileChange?: string
  }
  [key: string]: unknown
}

function getAgentMindBin(): string {
  if (process.env.AGENTMIND_DEV) {
    return "agentmind"
  }
  return "agentmind"
}

function getHookScript(name: string): string {
  return path.join(HOOKS_DIR, `${name}.mjs`)
}

function getNodeHookCommand(name: string): string {
  return `node ${getHookScript(name)}`
}

function writeAgentMindConfig(projectRoot: string): void {
  const cliEntry = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../cli/index.js",
  )
  const configPath = path.join(projectRoot, ".agentmind", "config.json")
  const config = {
    command: [process.execPath, cliEntry],
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

export function getCodexHookConfig(agentMindBin: string): HookConfig[] {
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
  ]
}

export function installCodexHooks(projectRoot: string, agentMindBin?: string): void {
  const hooksDir = path.join(projectRoot, HOOKS_DIR)
  const codexDir = path.join(projectRoot, CODEX_CONFIG_DIR)

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true })
  }
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true })
  }

  writeAgentMindConfig(projectRoot)

  fs.writeFileSync(path.join(hooksDir, "pre-tool-use.mjs"), generatePreToolUseHook())
  fs.writeFileSync(path.join(hooksDir, "post-tool-use.mjs"), generatePostToolUseHook())
  fs.writeFileSync(path.join(hooksDir, "post-commit.mjs"), generatePostCommitHook())

  const configPath = path.join(codexDir, CODEX_CONFIG_FILE)
  let config: CodexConfig = {}

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    } catch {
      config = {}
    }
  }

  config.hooks = {
    preToolUse: getNodeHookCommand("pre-tool-use"),
    postToolUse: getNodeHookCommand("post-tool-use"),
    onFileChange: getNodeHookCommand("post-commit"),
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

export function uninstallCodexHooks(projectRoot: string): void {
  const configPath = path.join(projectRoot, CODEX_CONFIG_DIR, CODEX_CONFIG_FILE)

  if (!fs.existsSync(configPath)) {
    return
  }

  let config: CodexConfig
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
  } catch {
    return
  }

  if (config.hooks) {
    delete config.hooks.preToolUse
    delete config.hooks.postToolUse
    delete config.hooks.onFileChange

    if (Object.keys(config.hooks).length === 0) {
      delete config.hooks
    }
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

  const hooksDir = path.join(projectRoot, HOOKS_DIR)
  if (fs.existsSync(hooksDir)) {
    const hookFiles = ["pre-tool-use.mjs", "post-tool-use.mjs", "post-commit.mjs"]
    for (const file of hookFiles) {
      const filePath = path.join(hooksDir, file)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }
  }
}

export function isCodexHooksInstalled(projectRoot: string): boolean {
  const configPath = path.join(projectRoot, CODEX_CONFIG_DIR, CODEX_CONFIG_FILE)

  if (!fs.existsSync(configPath)) {
    return false
  }

  try {
    const config: CodexConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    return !!(config.hooks?.preToolUse?.includes("pre-tool-use.mjs"))
  } catch {
    return false
  }
}
