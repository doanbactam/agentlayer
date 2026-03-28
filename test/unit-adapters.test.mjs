import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ContextStore } from "../dist/store/schema.js"
import { cursor } from "../dist/adapters/cursor.js"
import { windsurf } from "../dist/adapters/windsurf.js"
import { SYNC_MARKER_START, SYNC_MARKER_END } from "../dist/adapters/types.js"

function createTempProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmind-adapters-"))
  mkdirSync(path.join(dir, ".agentmind"), { recursive: true })
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

test("cursor adapter sync writes to .cursorrules", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    cursor.sync(dir, store)

    const rulesPath = path.join(dir, ".cursorrules")
    assert.ok(existsSync(rulesPath), ".cursorrules should be created")

    const content = readFileSync(rulesPath, "utf-8")
    assert.ok(content.includes(SYNC_MARKER_START), "should contain sync marker start")
    assert.ok(content.includes(SYNC_MARKER_END), "should contain sync marker end")
    assert.ok(content.includes("TypeScript files"), "should contain rule description")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("windsurf adapter sync writes to .windsurfrules", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    windsurf.sync(dir, store)

    const rulesPath = path.join(dir, ".windsurfrules")
    assert.ok(existsSync(rulesPath), ".windsurfrules should be created")

    const content = readFileSync(rulesPath, "utf-8")
    assert.ok(content.includes(SYNC_MARKER_START), "should contain sync marker start")
    assert.ok(content.includes(SYNC_MARKER_END), "should contain sync marker end")
    assert.ok(content.includes("TypeScript files"), "should contain rule description")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("cursor adapter unsync removes agentmind block", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    // Pre-create file with existing content so unsync doesn't delete it
    const rulesPath = path.join(dir, ".cursorrules")
    const existingContent = "# Existing rules\nBe kind to users.\n"
    writeFileSync(rulesPath, existingContent)

    cursor.sync(dir, store)

    let content = readFileSync(rulesPath, "utf-8")
    assert.ok(content.includes(SYNC_MARKER_START), "should have marker before unsync")

    cursor.unsync(dir)

    content = readFileSync(rulesPath, "utf-8")
    assert.ok(!content.includes(SYNC_MARKER_START), "should not have marker after unsync")
    assert.ok(!content.includes("TypeScript files"), "should not contain rule after unsync")
    assert.ok(content.includes("Be kind to users"), "should preserve existing content")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("windsurf adapter unsync removes agentmind block", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    // Pre-create file with existing content so unsync doesn't delete it
    const rulesPath = path.join(dir, ".windsurfrules")
    const existingContent = "# Existing rules\nBe kind to users.\n"
    writeFileSync(rulesPath, existingContent)

    windsurf.sync(dir, store)

    let content = readFileSync(rulesPath, "utf-8")
    assert.ok(content.includes(SYNC_MARKER_START), "should have marker before unsync")

    windsurf.unsync(dir)

    content = readFileSync(rulesPath, "utf-8")
    assert.ok(!content.includes(SYNC_MARKER_START), "should not have marker after unsync")
    assert.ok(!content.includes("TypeScript files"), "should not contain rule after unsync")
    assert.ok(content.includes("Be kind to users"), "should preserve existing content")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("cursor sync is idempotent (calling twice doesn't duplicate)", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "UniqueRuleDescription123",
      priority: 60,
    })

    cursor.sync(dir, store)
    cursor.sync(dir, store)

    const rulesPath = path.join(dir, ".cursorrules")
    const content = readFileSync(rulesPath, "utf-8")

    // Count occurrences of the marker - should be exactly 1
    const markerCount = (content.match(/<!-- agentmind:sync -->/g) || []).length
    assert.equal(markerCount, 1, "should have exactly one sync marker")

    // Rule description should appear once (not duplicated)
    const ruleCount = (content.match(/UniqueRuleDescription123/g) || []).length
    assert.equal(ruleCount, 1, "rule should appear exactly once")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("windsurf sync is idempotent (calling twice doesn't duplicate)", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "UniqueRuleDescription456",
      priority: 60,
    })

    windsurf.sync(dir, store)
    windsurf.sync(dir, store)

    const rulesPath = path.join(dir, ".windsurfrules")
    const content = readFileSync(rulesPath, "utf-8")

    // Count occurrences of the marker - should be exactly 1
    const markerCount = (content.match(/<!-- agentmind:sync -->/g) || []).length
    assert.equal(markerCount, 1, "should have exactly one sync marker")

    // Rule description should appear once (not duplicated)
    const ruleCount = (content.match(/UniqueRuleDescription456/g) || []).length
    assert.equal(ruleCount, 1, "rule should appear exactly once")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("cursor sync creates file if it doesn't exist", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    const rulesPath = path.join(dir, ".cursorrules")
    assert.ok(!existsSync(rulesPath), "file should not exist initially")

    cursor.sync(dir, store)

    assert.ok(existsSync(rulesPath), "file should be created")
    const content = readFileSync(rulesPath, "utf-8")
    assert.ok(content.includes(SYNC_MARKER_START), "should contain sync marker")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("windsurf sync creates file if it doesn't exist", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    const rulesPath = path.join(dir, ".windsurfrules")
    assert.ok(!existsSync(rulesPath), "file should not exist initially")

    windsurf.sync(dir, store)

    assert.ok(existsSync(rulesPath), "file should be created")
    const content = readFileSync(rulesPath, "utf-8")
    assert.ok(content.includes(SYNC_MARKER_START), "should contain sync marker")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("cursor sync appends to existing file with content", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    // Pre-create .cursorrules with some existing content
    const rulesPath = path.join(dir, ".cursorrules")
    const existingContent = "# Existing rules\nBe kind to users.\n"
    mkdirSync(dir, { recursive: true })
    writeFileSync(rulesPath, existingContent)

    cursor.sync(dir, store)

    const content = readFileSync(rulesPath, "utf-8")
    assert.ok(content.includes("Be kind to users"), "should preserve existing content")
    assert.ok(content.includes(SYNC_MARKER_START), "should add sync marker")
    assert.ok(content.includes("TypeScript files"), "should add new rule")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("unsync on file with only agentmind content removes file", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    cursor.sync(dir, store)
    const rulesPath = path.join(dir, ".cursorrules")

    assert.ok(existsSync(rulesPath), "file should exist after sync")

    cursor.unsync(dir)

    // File should be deleted since it only contained agentmind content
    assert.ok(!existsSync(rulesPath), "file should be removed after unsync of empty content")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("isInstalled returns true after sync", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    assert.ok(!cursor.isInstalled(dir), "should not be installed initially")

    cursor.sync(dir, store)

    assert.ok(cursor.isInstalled(dir), "should be installed after sync")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("isInstalled returns false after unsync", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addRule({
      id: "rule-001",
      pattern: "*.ts",
      description: "TypeScript files",
      priority: 60,
    })

    cursor.sync(dir, store)
    assert.ok(cursor.isInstalled(dir), "should be installed after sync")

    cursor.unsync(dir)
    assert.ok(!cursor.isInstalled(dir), "should not be installed after unsync")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("sync includes annotations", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    store.addAnnotation({
      id: "ann-001",
      path: "src/utils.ts",
      text: "Helper functions",
      author: "user",
      created: Date.now(),
    })

    cursor.sync(dir, store)

    const content = readFileSync(path.join(dir, ".cursorrules"), "utf-8")
    assert.ok(content.includes("Helper functions"), "should include annotation text")
    assert.ok(content.includes("Annotations"), "should include annotations section")
    store.close()
  } finally {
    cleanup(dir)
  }
})
