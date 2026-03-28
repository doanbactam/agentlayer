import chalk from "chalk"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { adapters, getAdapter, getAdapterNames } from "../../adapters/index.js"
import { ContextStore } from "../../store/schema.js"

export async function sync(opts: { tool?: string; dryRun?: boolean; remove?: boolean }) {
  const cwd = process.cwd()
  const dbPath = join(cwd, ".agentlayer", "context.db")

  if (!existsSync(dbPath)) {
    console.error(chalk.red("\n  agentlayer is not initialized. Run `agentlayer init` first.\n"))
    process.exit(1)
  }

  const targets = opts.tool ? [opts.tool] : getAdapterNames()

  if (opts.remove) {
    for (const name of targets) {
      const adapter = getAdapter(name)
      if (!adapter) {
        console.error(chalk.red(`  Unknown tool: ${name}. Available: ${getAdapterNames().join(", ")}`))
        continue
      }
      if (!adapter.isInstalled(cwd)) {
        console.log(chalk.yellow(`  agentlayer context not found in ${adapter.filename}`))
        continue
      }
      adapter.unsync(cwd)
      console.log(chalk.green("  \u2713") + ` Removed sync from ${chalk.bold(adapter.filename)}`)
    }
    console.log("")
    return
  }

  const store = new ContextStore(cwd)
  try {
    const health = store.getHealth()
    if (health.entries === 0) {
      console.error(chalk.yellow("\n  No context entries found in store."))
      console.error(chalk.gray("  Run `agentlayer scan` to populate the store first.\n"))
      process.exit(1)
    }

    for (const name of targets) {
      const adapter = getAdapter(name)
      if (!adapter) {
        console.error(chalk.red(`  Unknown tool: ${name}. Available: ${getAdapterNames().join(", ")}`))
        continue
      }

      if (opts.dryRun) {
        const entries = store.getEntries()
        console.log(chalk.cyan(`\n  [${adapter.name}] ${adapter.filename} (dry run):`))
        console.log(chalk.gray(`  Would sync ${entries.length} entries\n`))
        continue
      }

      adapter.sync(cwd, store)
      console.log(chalk.green("  \u2713") + ` Synced ${chalk.bold(String(health.entries))} entries to ${chalk.cyan(adapter.filename)}`)
    }
  } finally {
    store.close()
  }

  console.log("")
}
