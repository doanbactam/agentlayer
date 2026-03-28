import chalk from "chalk"
import { AgentBridge, detectAllConflicts } from "../../bridge/index.js"

export async function agents() {
  const bridge = new AgentBridge(process.cwd())
  const active = bridge.getActiveAgents()
  const conflicts = detectAllConflicts(bridge)

  console.log("")
  console.log(chalk.bold("  agentmind agents"))
  console.log(chalk.gray("  " + "\u2500".repeat(40)))
  console.log("")

  if (active.length === 0) {
    console.log(chalk.gray("  No active agents."))
  } else {
    for (const agent of active) {
      const files = agent.editingFiles.length > 0
        ? chalk.yellow(` [${agent.editingFiles.length} claimed]`)
        : ""
      console.log(`  ${chalk.green("\u2713")} ${chalk.bold(agent.agentId)} ${chalk.gray(agent.tool)}${files}`)
      if (agent.editingFiles.length > 0) {
        for (const f of agent.editingFiles) {
          console.log(chalk.gray(`      editing: ${f}`))
        }
      }
    }
  }

  if (conflicts.length > 0) {
    console.log("")
    console.log(chalk.red(`  Conflicts (${conflicts.length}):`))
    for (const c of conflicts) {
      const label = c.severity === "critical" ? "!!" : "!"
      console.log(
        chalk.red(`    ${label} ${c.filePath}`) +
          chalk.gray(` - agents: ${c.conflictingAgents.join(", ")}`)
      )
    }
  }

  console.log("")
}
