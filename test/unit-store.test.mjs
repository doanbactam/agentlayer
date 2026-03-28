import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ContextStore } from "../dist/store/schema.js"

function createTempProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmind-store-"))
  mkdirSync(path.join(dir, ".agentmind"), { recursive: true })
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

test("addRule and getEntries round-trip", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    const rule = {
      id: "rule-001",
      pattern: "no-console",
      description: "Avoid console.log in production",
      priority: 60,
    }
    store.addRule(rule)

    const entries = store.getEntries({ type: "rule" })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].path, "no-console")
    assert.equal(entries[0].rules.length, 1)
    assert.equal(entries[0].rules[0].pattern, "no-console")
    assert.equal(entries[0].rules[0].description, "Avoid console.log in production")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("addAnnotation and queryAnnotations", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    const annotation = {
      id: "ann-001",
      path: "src/index.ts",
      text: "Main entry point",
      author: "user",
      created: Date.now(),
    }
    store.addAnnotation(annotation)

    const entries = store.getEntries({ type: "annotation", filePath: "src/index.ts" })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].annotations.length, 1)
    assert.equal(entries[0].annotations[0].text, "Main entry point")
    assert.equal(entries[0].annotations[0].author, "user")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("logBehavior stores correctly", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    const behavior = {
      id: "beh-001",
      path: "src/utils.ts",
      pattern: "import-default",
      description: "Frequently imports lodash",
      frequency: 5,
      lastSeen: Date.now(),
    }
    store.logBehavior(behavior, true)

    const behaviors = store.getBehaviors({ filePath: "src/utils.ts" })
    assert.equal(behaviors.length, 1)
    assert.equal(behaviors[0].description, "Frequently imports lodash")
    assert.equal(behaviors[0].frequency, 5) // getBehaviors reads frequency from metadata
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("getHealth returns valid structure", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    const health = store.getHealth()

    assert.ok(typeof health.dbSize === "number")
    assert.ok(typeof health.entries === "number")
    assert.ok(typeof health.staleEntries === "number")
    assert.ok(typeof health.orphanedRules === "number")
    assert.ok(health.dbSize >= 0)
    assert.ok(health.entries >= 0)
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("queryContext returns relevant results", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Add an annotation
    store.addAnnotation({
      id: "ann-001",
      path: "src/api.ts",
      text: "API routes handler",
      author: "user",
      created: Date.now(),
    })

    // Query with file path
    const entries = store.queryContext({ filePath: "src/api.ts" })
    assert.ok(entries.length >= 1)
    const apiEntry = entries.find(e => e.path === "src/api.ts")
    assert.ok(apiEntry, "Should find entry for src/api.ts")
    assert.equal(apiEntry.annotations[0].text, "API routes handler")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("replaceRules replaces all rules for a source", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Add initial rules
    store.addRule({
      id: "rule-001",
      pattern: "no-console",
      description: "No console",
      priority: 50,
    })

    // Replace with new rules
    store.replaceRules("scanner", [
      {
        id: "rule-002",
        pattern: "no-debugger",
        description: "No debugger",
        priority: 60,
      },
      {
        id: "rule-003",
        pattern: "no-alert",
        description: "No alert",
        priority: 40,
      },
    ])

    const entries = store.getEntries({ type: "rule" })
    // Should have only the new rules (2), not the initial one
    assert.equal(entries.length, 2)
    const patterns = entries.flatMap(e => e.rules.map(r => r.pattern))
    assert.ok(patterns.includes("no-debugger"))
    assert.ok(patterns.includes("no-alert"))
    assert.ok(!patterns.includes("no-console"))
    store.close()
  } finally {
    cleanup(dir)
  }
})
