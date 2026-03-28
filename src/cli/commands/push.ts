import chalk from "chalk"
import { execSync, execFileSync } from "node:child_process"
import { existsSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ContextStore } from "../../store/schema.js"
import { exportJSONL } from "../../store/jsonl.js"
import { isGitRepo } from "../utils.js"

export async function push(opts: { message?: string; remote?: boolean }): Promise<void> {
  const root = process.cwd()
  const dbPath = join(root, ".agentmind", "context.db")
  const jsonlPath = join(root, ".agentmind", "context.jsonl")

  if (!existsSync(dbPath)) {
    console.log(chalk.yellow("No agentmind store found. Run `agentmind init` first."))
    return
  }

  const store = new ContextStore(root)
  const db = store.getDb()

  const totalRows = (db.query("SELECT COUNT(*) as c FROM context_entries").get() as { c: number }).c
  if (totalRows === 0) {
    console.log(chalk.dim("No context entries to push."))
    store.close()
    return
  }

  const before = existsSync(jsonlPath) ? readFileSync(jsonlPath, "utf-8") : ""
  const after = exportJSONL(store)
  store.close()

  if (before === after) {
    console.log(chalk.green("Context is already in sync."))
    return
  }

  writeFileSync(jsonlPath, after, "utf-8")

  const lineCount = after.trim().split("\n").filter(Boolean).length
  console.log(chalk.green(`Pushed ${lineCount} entries to .agentmind/context.jsonl`))

  if (!isGitRepo(root)) {
    console.log(chalk.dim("Not a git repository. JSONL export is local only."))
    return
  }

  try {
    const status = execSync("git status --porcelain .agentmind/context.jsonl", { cwd: root, encoding: "utf-8" }).trim()
    if (!status) {
      console.log(chalk.green("Context is already in sync."))
      return
    }

    const msg = opts.message ?? "agentmind: update context"
    execFileSync("git", ["add", ".agentmind/context.jsonl"], { cwd: root, stdio: "pipe" })
    execFileSync("git", ["commit", "-m", msg], { cwd: root, stdio: "pipe" })
    console.log(chalk.dim(`Committed as: "${msg}"`))
  } catch (err) {
    console.log(chalk.yellow(`Git commit failed: ${summarizeExecError(err)}`))
    console.log(chalk.dim("JSONL file is updated locally but was not committed."))
    return
  }

  if (opts.remote) {
    try {
      execSync("git push", { cwd: root, stdio: "pipe" })
      console.log(chalk.green("Pushed to remote."))
    } catch (err) {
      console.log(chalk.yellow(`Git push failed: ${summarizeExecError(err)}`))
      console.log(chalk.dim("Commit succeeded locally but was not pushed."))
    }
  }
}

function summarizeExecError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.split("\n")[0]
  }
  return "command failed"
}
