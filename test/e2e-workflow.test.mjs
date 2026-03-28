import test from "node:test"
import assert from "node:assert/strict"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
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

function createFixtureProject(prefix) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), prefix))
  mkdirSync(path.join(fixtureRoot, "src"), { recursive: true })
  writeFileSync(path.join(fixtureRoot, ".gitignore"), "node_modules\n")
  writeFileSync(
    path.join(fixtureRoot, "package.json"),
    JSON.stringify({
      name: "fixture-app",
      version: "1.0.0",
      type: "module",
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
  writeFileSync(
    path.join(fixtureRoot, "src", "utils.ts"),
    [
      "export function add(a: number, b: number) {",
      "  return a + b",
      "}",
      "",
    ].join("\n"),
  )
  return fixtureRoot
}

function insertAnnotation(root, filePath, text) {
  const dbPath = path.join(root, ".agentmind", "context.db")
  const db = new Database(dbPath)
  try {
    db.prepare(`
      INSERT INTO context_entries (file_path, type, content, scope, priority, source)
      VALUES (?, 'annotation', ?, 'global', 'normal', 'test')
    `).run(
      filePath,
      JSON.stringify({
        id: `ann-${Date.now()}`,
        path: filePath,
        text,
        author: "test",
        created: Date.now(),
      }),
    )
  } finally {
    db.close()
  }
}

// 1. Full init -> scan -> annotate -> status workflow
test("full init-scan-annotate-status workflow", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-workflow-")

  try {
    // init
    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)
    assert.ok(existsSync(path.join(fixtureRoot, ".agentmind", "context.db")))
    assert.ok(existsSync(path.join(fixtureRoot, ".agentmind", "context.jsonl")))

    // scan
    const scan = runCli(["scan"], fixtureRoot)
    assert.equal(scan.status, 0, scan.stderr || scan.stdout)

    // annotate via direct DB insert (avoids interactive prompt issues)
    insertAnnotation(fixtureRoot, "src/index.ts", "Main entry point for the app")

    // status should show entries
    const status = runCli(["status"], fixtureRoot)
    assert.equal(status.status, 0, status.stderr || status.stdout)
    assert.match(status.stdout, /Context coverage:/)

    // verify annotation exists in database
    const dbPath = path.join(fixtureRoot, ".agentmind", "context.db")
    const db = new Database(dbPath, { readonly: true })
    const row = db.prepare(`
      SELECT COUNT(*) as c FROM context_entries
      WHERE type = 'annotation' AND file_path = 'src/index.ts'
    `).get()
    db.close()
    assert.ok(row.c >= 1, "Annotation should be in database")
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

// 2. Sync to cursor then unsync
test("sync to cursor then unsync removes markers", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-sync-")

  try {
    // init and scan first
    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)

    const scan = runCli(["scan"], fixtureRoot)
    assert.equal(scan.status, 0, scan.stderr || scan.stdout)

    // ensure there are entries to sync
    insertAnnotation(fixtureRoot, "src/index.ts", "Sync test annotation")

    // pre-create .cursorrules with existing content so unsync doesn't delete the file
    writeFileSync(path.join(fixtureRoot, ".cursorrules"), "# Existing rules\nBe kind to users.\n")

    // sync to cursor
    const syncResult = runCli(["sync", "cursor"], fixtureRoot)
    assert.equal(syncResult.status, 0, syncResult.stderr || syncResult.stdout)

    const cursorRulesPath = path.join(fixtureRoot, ".cursorrules")
    assert.ok(existsSync(cursorRulesPath), ".cursorrules should exist")

    const cursorContent = readFileSync(cursorRulesPath, "utf-8")
    assert.match(cursorContent, /<!-- agentmind:sync -->/)
    assert.match(cursorContent, /<!-- agentmind:endsync -->/)

    // unsync cursor
    const unsyncResult = runCli(["unsync", "cursor"], fixtureRoot)
    assert.equal(unsyncResult.status, 0, unsyncResult.stderr || unsyncResult.stdout)

    // markers should be removed
    const afterUnsync = readFileSync(cursorRulesPath, "utf-8")
    assert.doesNotMatch(afterUnsync, /<!-- agentmind:sync -->/)
    assert.doesNotMatch(afterUnsync, /<!-- agentmind:endsync -->/)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

// 3. Health command after scan
test("health command shows coverage info after scan", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-health-")

  try {
    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)

    const scan = runCli(["scan"], fixtureRoot)
    assert.equal(scan.status, 0, scan.stderr || scan.stdout)

    const health = runCli(["health"], fixtureRoot)
    assert.equal(health.status, 0, health.stderr || health.stdout)

    // health output should contain coverage info
    assert.match(health.stdout, /agentmind health/)
    assert.match(health.stdout, /Coverage by directory/)

    // test JSON output
    const healthJson = runCli(["health", "--json"], fixtureRoot)
    assert.equal(healthJson.status, 0, healthJson.stderr || healthJson.stdout)

    const parsed = JSON.parse(healthJson.stdout)
    assert.ok(Array.isArray(parsed.dirCoverage))
    assert.ok(Array.isArray(parsed.classifications))
    assert.ok(Array.isArray(parsed.recommendations))
    assert.equal(typeof parsed.totalFiles, "number")
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

// 4. Share exports context
test("share exports context as JSON file", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-share-")

  try {
    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)

    const scan = runCli(["scan"], fixtureRoot)
    assert.equal(scan.status, 0, scan.stderr || scan.stdout)

    // add an annotation to ensure entries exist
    insertAnnotation(fixtureRoot, "src/index.ts", "Test annotation for export")

    const outputPath = path.join(fixtureRoot, "context.json")
    const share = runCli(["share", "-f", "json", "-o", "context.json"], fixtureRoot)
    assert.equal(share.status, 0, share.stderr || share.stdout)

    assert.ok(existsSync(outputPath), "context.json should be created")

    const content = readFileSync(outputPath, "utf-8")
    const parsed = JSON.parse(content)

    assert.equal(parsed.version, "1.0")
    assert.ok(Array.isArray(parsed.entries))
    assert.ok(parsed.entries.length > 0, "Should have entries")
    assert.ok(parsed.meta)
    assert.equal(typeof parsed.meta.totalEntries, "number")
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

// 5. Template list and apply
test("template list shows available templates", () => {
  const list = runCli(["template", "list"])
  assert.equal(list.status, 0, list.stderr || list.stdout)

  // Should list known templates
  assert.match(list.stdout, /nextjs/)
  assert.match(list.stdout, /rules,/)
})

test("template apply adds rules for nextjs project", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-template-")

  try {
    // Create a next.config.js to trigger nextjs detection
    writeFileSync(
      path.join(fixtureRoot, "next.config.js"),
      'module.exports = {}',
    )

    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)

    const apply = runCli(["template", "apply", "nextjs"], fixtureRoot)
    assert.equal(apply.status, 0, apply.stderr || apply.stdout)

    // Check that rules were added to the database
    const dbPath = path.join(fixtureRoot, ".agentmind", "context.db")
    const db = new Database(dbPath, { readonly: true })
    const row = db.prepare(`
      SELECT COUNT(*) as c FROM context_entries WHERE type = 'rule'
    `).get()
    db.close()

    assert.ok(row.c > 0, "Template should add rules")
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

// 6. Behaviors and insights
test("log-behavior, behaviors, and insights work together", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-behaviors-")

  try {
    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)

    // Log some behaviors (this command is hidden but still works)
    const log1 = runCli(["log-behavior", "-f", "src/index.ts", "-t", "edit", "-e", "tool-use", "-s", "true"], fixtureRoot)
    assert.equal(log1.status, 0, log1.stderr || log1.stdout)

    const log2 = runCli(["log-behavior", "-f", "src/utils.ts", "-t", "edit", "-e", "tool-use", "-s", "false"], fixtureRoot)
    assert.equal(log2.status, 0, log2.stderr || log2.stdout)

    // behaviors should show logged entries
    const behaviors = runCli(["behaviors", "-n", "10"], fixtureRoot)
    assert.equal(behaviors.status, 0, behaviors.stderr || behaviors.stdout)
    assert.match(behaviors.stdout, /Recent agent behavior/)

    // insights should analyze the behavior data
    const insights = runCli(["insights"], fixtureRoot)
    assert.equal(insights.status, 0, insights.stderr || insights.stdout)
    assert.match(insights.stdout, /agentmind insights/)

    // insights JSON output
    const insightsJson = runCli(["insights", "--json"], fixtureRoot)
    assert.equal(insightsJson.status, 0, insightsJson.stderr || insightsJson.stdout)

    const parsed = JSON.parse(insightsJson.stdout)
    assert.ok(parsed.totalEvents >= 2)
    assert.ok(Array.isArray(parsed.hotFiles))
    assert.ok(Array.isArray(parsed.hotspots))
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

// 7. Bridge register and status
test("bridge register and status work correctly", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-bridge-")

  try {
    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)

    // Register an agent
    const register = runCli(["bridge", "register", "--id", "test-agent-1", "--tool", "claude"], fixtureRoot)
    assert.equal(register.status, 0, register.stderr || register.stdout)
    assert.match(register.stdout, /registered test-agent-1/)

    // Check status shows the agent
    const status = runCli(["bridge", "status"], fixtureRoot)
    assert.equal(status.status, 0, status.stderr || status.stdout)
    assert.match(status.stdout, /active agents/)
    assert.match(status.stdout, /test-agent-1/)
    assert.match(status.stdout, /claude/)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

// Additional test: push exports to JSONL
test("push exports entries to context.jsonl", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-push-")

  try {
    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)

    insertAnnotation(fixtureRoot, "src/index.ts", "push test annotation")

    const push = runCli(["push"], fixtureRoot)
    assert.equal(push.status, 0, push.stderr || push.stdout)
    assert.match(push.stdout, /Pushed \d+ entries to \.agentmind\/context\.jsonl/)

    const jsonl = readFileSync(path.join(fixtureRoot, ".agentmind", "context.jsonl"), "utf-8")
    assert.match(jsonl, /push test annotation/)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

// Additional test: pull with force reimports
test("pull --force reimports from JSONL", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-pull-")

  try {
    const init = runCli(["init"], fixtureRoot)
    assert.equal(init.status, 0, init.stderr || init.stdout)

    // Add a new entry to JSONL
    const jsonlPath = path.join(fixtureRoot, ".agentmind", "context.jsonl")
    const existing = readFileSync(jsonlPath, "utf-8")
    const newId = Date.now()
    const newEntry = {
      id: newId,
      type: "annotation",
      scope: "global",
      filePath: "src/utils.ts",
      content: {
        id: `ann-${newId}`,
        path: "src/utils.ts",
        text: "pulled annotation",
        author: "test",
        created: Date.now(),
      },
      priority: "normal",
      source: "test",
      timestamp: new Date().toISOString(),
    }
    writeFileSync(jsonlPath, existing + JSON.stringify(newEntry) + "\n", "utf-8")

    const pull = runCli(["pull", "--force"], fixtureRoot)
    assert.equal(pull.status, 0, pull.stderr || pull.stdout)
    assert.match(pull.stdout, /Pulled/)

    // Verify annotation is in database
    const dbPath = path.join(fixtureRoot, ".agentmind", "context.db")
    const db = new Database(dbPath, { readonly: true })
    const row = db.prepare(`
      SELECT COUNT(*) as c FROM context_entries
      WHERE type = 'annotation' AND file_path = 'src/utils.ts'
    `).get()
    db.close()
    assert.ok(row.c >= 1, "Pulled annotation should be in database")
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})
