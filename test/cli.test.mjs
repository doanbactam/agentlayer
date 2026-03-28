import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import Database from "better-sqlite3"

const projectRoot = process.cwd()
const cliPath = path.join(projectRoot, "dist", "cli", "index.js")

function runCli(args, cwd = projectRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
  })
}

test("cli help renders under node", () => {
  const result = runCli(["--help"])
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Usage: agentmind/)
})

test("init + scan do not duplicate scanner rules", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "agentmind-"))

  try {
    mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
    writeFileSync(path.join(fixtureRoot, ".gitignore"), "node_modules\n")
    writeFileSync(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "fixture-app",
        version: "1.0.0",
        type: "module",
        packageManager: "npm@10.9.0",
        scripts: {
          custom: "node src/index.js",
        },
      }, null, 2),
    )
    writeFileSync(
      path.join(fixtureRoot, "src", "index.ts"),
      [
        "export function main() {",
        "  // TODO: replace mock logic",
        "  return process.platform",
        "}",
        "",
      ].join("\n"),
    )

    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)

    const dbPath = path.join(fixtureRoot, ".agentmind", "context.db")
    const jsonlPath = path.join(fixtureRoot, ".agentmind", "context.jsonl")
    const initialJsonl = readFileSync(jsonlPath, "utf-8")
    assert.ok(initialJsonl.length > 0)

    const db = new Database(dbPath, { readonly: true })
    const initialRules = db.prepare("SELECT COUNT(*) as c FROM context_entries WHERE type = 'rule'").get().c
    db.close()
    assert.ok(initialRules > 0)

    const scan = runCli(["scan"], fixtureRoot)
    assert.equal(scan.status, 0, scan.stderr || scan.stdout)

    const dbAfter = new Database(dbPath, { readonly: true })
    const afterRules = dbAfter.prepare("SELECT COUNT(*) as c FROM context_entries WHERE type = 'rule'").get().c
    dbAfter.close()

    assert.equal(afterRules, initialRules, "scanner rules should be replaced, not duplicated")
    assert.equal(readFileSync(jsonlPath, "utf-8"), initialJsonl, "jsonl export should stay stable on no-op scan")

    const status = runCli(["status"], fixtureRoot)
    assert.equal(status.status, 0, status.stderr || status.stdout)
    assert.match(status.stdout, /Context coverage:/)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})
