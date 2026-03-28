import chalk from "chalk"
import { AgentBridge, detectAllConflicts } from "../../bridge/index.js"

function getBridge(): AgentBridge {
  return new AgentBridge(process.cwd())
}

export async function register(opts: {
  id: string
  tool: string
}): Promise<void> {
  const bridge = getBridge()
  bridge.register(opts.id, opts.tool)
  console.log(`registered ${opts.id} (${opts.tool})`)
}

export async function claim(opts: {
  id: string
  files: string[]
}): Promise<void> {
  const bridge = getBridge()
  bridge.claimFiles(opts.id, opts.files)

  const conflicts = opts.files.flatMap((f) => {
    const editing = bridge.whoIsEditing(f).filter((a) => a.agentId !== opts.id)
    if (editing.length === 0) return []
    return [{ filePath: f, agents: editing.map((a) => a.agentId) }]
  })

  console.log(`${opts.id} claimed ${opts.files.length} file(s)`)
  if (conflicts.length > 0) {
    console.log(chalk.yellow("\nconflicts:"))
    for (const c of conflicts) {
      console.log(chalk.yellow(`  ${c.filePath} — also edited by ${c.agents.join(", ")}`))
    }
  }
}

export async function release(opts: {
  id: string
  files: string[]
}): Promise<void> {
  const bridge = getBridge()
  bridge.releaseFiles(opts.id, opts.files)
  console.log(`${opts.id} released ${opts.files.length} file(s)`)
}

export async function bridgeStatus(): Promise<void> {
  const bridge = getBridge()
  const agents = bridge.getActiveAgents()

  if (agents.length === 0) {
    console.log("no active agents")
    return
  }

  console.log(chalk.bold(`\n  active agents (${agents.length})\n`))
  for (const a of agents) {
    const ago = Math.round((Date.now() - a.lastHeartbeat) / 1000)
    const files = a.editingFiles.length > 0
      ? a.editingFiles.map((f) => `\n    ${chalk.gray(f)}`).join("")
      : "\n    (no files claimed)"
    console.log(`  ${chalk.bold(a.agentId)}  ${chalk.gray(a.tool)}  ${chalk.gray(`${ago}s ago`)}`)
    console.log(files)
  }

  const conflicts = detectAllConflicts(bridge)
  if (conflicts.length > 0) {
    console.log(chalk.yellow(`\n  conflicts (${conflicts.length})\n`))
    for (const c of conflicts) {
      const label = c.severity === "critical" ? chalk.red("CRITICAL") : chalk.yellow("WARN")
      console.log(`  ${label}  ${c.filePath}`)
      console.log(chalk.gray(`    agents: ${c.conflictingAgents.join(", ")}`))
    }
  }

  console.log("")
}

export async function conflicts(): Promise<void> {
  const bridge = getBridge()
  const all = detectAllConflicts(bridge)

  if (all.length === 0) {
    console.log("no conflicts")
    return
  }

  console.log(chalk.bold(`\n  conflicts (${all.length})\n`))
  for (const c of all) {
    const label = c.severity === "critical" ? chalk.red("CRITICAL") : chalk.yellow("WARN")
    console.log(`  ${label}  ${c.filePath}`)
    console.log(chalk.gray(`    agents: ${c.conflictingAgents.join(", ")}`))
  }
  console.log("")
}
