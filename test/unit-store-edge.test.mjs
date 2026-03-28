import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ContextStore } from "../dist/store/schema.js"

function createTempProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmind-edge-"))
  mkdirSync(path.join(dir, ".agentmind"), { recursive: true })
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

test("addRule with missing optional fields (no path)", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    // Rule with no path, only pattern
    const rule = {
      pattern: "no-console",
      description: "Avoid console.log in production",
      priority: 60,
    }
    store.addRule(rule)

    const entries = store.getEntries({ type: "rule" })
    assert.equal(entries.length, 1)
    // When path is undefined, file_path should be the pattern
    assert.equal(entries[0].path, "no-console")
    assert.equal(entries[0].rules[0].pattern, "no-console")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("queryContext with no matching entries returns empty array", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Query with no entries in store at all
    const entries = store.queryContext({ filePath: "src/other.ts" })
    assert.ok(Array.isArray(entries))
    // Should return empty array since no entries exist
    assert.equal(entries.length, 0)
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("replaceRules with empty array deletes all rules for that source", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Add initial rules from scanner
    store.addRule({
      path: "src/api.ts",
      pattern: "api-routes",
      description: "API routes",
      priority: 50,
      source: "scanner",
    })

    // Verify rule exists
    const beforeEntries = store.getEntries({ type: "rule" })
    assert.equal(beforeEntries.length, 1)

    // Replace with empty array
    store.replaceRules("scanner", [])

    // Should have no rules now
    const afterEntries = store.getEntries({ type: "rule" })
    assert.equal(afterEntries.length, 0)
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("addAnnotation with line number", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    const annotation = {
      path: "src/index.ts",
      text: "Important function starts here",
      author: "user",
      line: 42,
    }
    store.addAnnotation(annotation)

    const entries = store.getEntries({ type: "annotation", filePath: "src/index.ts" })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].annotations.length, 1)
    assert.equal(entries[0].annotations[0].text, "Important function starts here")
    assert.equal(entries[0].annotations[0].line, 42)
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("getHealth on empty store returns 0 entries", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    const health = store.getHealth()
    assert.equal(health.entries, 0)
    assert.equal(health.staleEntries, 0)
    assert.ok(health.dbSize >= 0)
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("double close doesn't throw", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // First close
    store.close()

    // Second close should not throw
    assert.doesNotThrow(() => {
      store.close()
    })
  } finally {
    cleanup(dir)
  }
})
