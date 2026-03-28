const CONFIG_READER = `
import { readFileSync } from "node:fs"

function getAgentMindCommand() {
  try {
    const config = JSON.parse(readFileSync(".agentmind/config.json", "utf-8"))
    if (Array.isArray(config.command) && config.command.every((part) => typeof part === "string" && part.length > 0)) {
      return config.command
    }
    if (typeof config.bin === "string" && config.bin.length > 0) {
      return [config.bin]
    }
  } catch {}
  return ["agentmind"]
}
`

const STDIN_READER = `
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString("utf-8")
}
`

export function generatePreToolUseHook(): string {
  return `#!/usr/bin/env node
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
${CONFIG_READER}
${STDIN_READER}

async function main() {
  try {
    const input = await readStdin()
    if (!input.trim()) {
      process.exit(0)
    }

    let toolInfo
    try {
      toolInfo = JSON.parse(input)
    } catch {
      process.exit(0)
    }

    const filePath = toolInfo?.tool_input?.file_path || toolInfo?.tool_input?.path
    if (!filePath || !existsSync(".agentmind/context.db")) {
      process.exit(0)
    }

    const command = getAgentMindCommand()
    const child = spawn(command[0], [...command.slice(1), "inject", "--file", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    for await (const chunk of child.stdout) {
      stdout += chunk.toString()
    }

    await new Promise((resolve) => child.on("close", resolve))

    if (stdout.trim()) {
      process.stdout.write(stdout)
    }
  } catch (error) {
    if (process.env.AGENTMIND_DEBUG) {
      console.error("[agentmind hook error]", error)
    }
  }
}

main()
`
}

export function generatePostToolUseHook(): string {
  return `#!/usr/bin/env node
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
${CONFIG_READER}
${STDIN_READER}

async function main() {
  try {
    const input = await readStdin()
    if (!input.trim()) {
      process.exit(0)
    }

    let resultInfo
    try {
      resultInfo = JSON.parse(input)
    } catch {
      process.exit(0)
    }

    const filePath = resultInfo?.tool_input?.file_path || resultInfo?.tool_input?.path
    if (!filePath || !existsSync(".agentmind/context.db")) {
      process.exit(0)
    }

    const toolName = resultInfo?.tool_name || "unknown"
    const success = !resultInfo?.tool_result?.error
    const command = getAgentMindCommand()
    const child = spawn(
      command[0],
      [...command.slice(1), "log-behavior", "--file", filePath, "--tool", toolName, "--success", String(success)],
      { stdio: "ignore", detached: true }
    )
    child.unref()
  } catch (error) {
    if (process.env.AGENTMIND_DEBUG) {
      console.error("[agentmind hook error]", error)
    }
  }
}

main()
`
}

export function generatePostCommitHook(): string {
  return `#!/usr/bin/env node
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
${CONFIG_READER}

async function main() {
  try {
    if (!existsSync(".agentmind/context.db")) {
      process.exit(0)
    }

    const diff = spawn("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    })

    let output = ""
    for await (const chunk of diff.stdout) {
      output += chunk.toString()
    }

    await new Promise((resolve) => diff.on("close", resolve))

    const changedFiles = output.trim().split("\\n").filter(Boolean)
    if (changedFiles.length === 0) {
      process.exit(0)
    }

    const command = getAgentMindCommand()
    for (const filePath of changedFiles) {
      const child = spawn(
        command[0],
        [...command.slice(1), "log-behavior", "--file", filePath, "--event", "commit"],
        { stdio: "ignore", detached: true }
      )
      child.unref()
    }
  } catch (error) {
    if (process.env.AGENTMIND_DEBUG) {
      console.error("[agentmind hook error]", error)
    }
  }
}

main()
`
}

export function generateAllHooks(): Map<string, string> {
  return new Map([
    ["pre-tool-use.mjs", generatePreToolUseHook()],
    ["post-tool-use.mjs", generatePostToolUseHook()],
    ["post-commit.mjs", generatePostCommitHook()],
  ])
}
