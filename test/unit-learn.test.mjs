import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ContextStore } from "../dist/store/schema.js"
import { analyzeBehaviors } from "../dist/learn/analyzer.js"

function createTempProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmind-learn-"))
  mkdirSync(path.join(dir, ".agentmind"), { recursive: true })
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

test("analyzeBehaviors returns empty array when no behaviors logged", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)
    const rules = analyzeBehaviors(store)
    assert.equal(rules.length, 0, "Should return empty array when no behaviors")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("analyzeBehaviors detects frequent failures", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Add multiple failures for the same file
    for (let i = 0; i < 3; i++) {
      store.logBehavior({
        id: `fail-${i}`,
        path: "src/problematic.ts",
        pattern: "edit-failure",
        description: "Failed to edit file",
        frequency: 1,
        lastSeen: Date.now(),
      }, false)
    }

    const rules = analyzeBehaviors(store)

    const failureRule = rules.find(r => r.pattern === "frequent-failure" && r.filePath === "src/problematic.ts")
    assert.ok(failureRule, "Should detect frequent-failure pattern")
    assert.ok(failureRule.description.includes("3 failures"), "Should mention failure count")
    assert.ok(failureRule.confidence > 0.5, "Should have reasonable confidence")
    assert.ok(failureRule.evidence.length > 0, "Should have evidence")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("analyzeBehaviors sets correct priority based on failure count", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // 5+ failures = critical
    for (let i = 0; i < 5; i++) {
      store.logBehavior({
        id: `critical-${i}`,
        path: "src/critical.ts",
        pattern: "edit-failure",
        description: "Failed",
        frequency: 1,
        lastSeen: Date.now(),
      }, false)
    }

    // 3-4 failures = high
    for (let i = 0; i < 3; i++) {
      store.logBehavior({
        id: `high-${i}`,
        path: "src/high.ts",
        pattern: "edit-failure",
        description: "Failed",
        frequency: 1,
        lastSeen: Date.now(),
      }, false)
    }

    // 2 failures = normal
    for (let i = 0; i < 2; i++) {
      store.logBehavior({
        id: `normal-${i}`,
        path: "src/normal.ts",
        pattern: "edit-failure",
        description: "Failed",
        frequency: 1,
        lastSeen: Date.now(),
      }, false)
    }

    const rules = analyzeBehaviors(store)

    const criticalRule = rules.find(r => r.filePath === "src/critical.ts")
    assert.equal(criticalRule?.suggestedPriority, "critical", "5+ failures should be critical")

    const highRule = rules.find(r => r.filePath === "src/high.ts")
    assert.equal(highRule?.suggestedPriority, "high", "3-4 failures should be high")

    const normalRule = rules.find(r => r.filePath === "src/normal.ts")
    assert.equal(normalRule?.suggestedPriority, "normal", "2 failures should be normal")

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("analyzeBehaviors detects retry loops", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Add multiple edits in short time span (within 30 min)
    const now = Date.now()
    for (let i = 0; i < 4; i++) {
      store.logBehavior({
        id: `retry-${i}`,
        path: "src/complex.ts",
        pattern: "multiple-edits",
        description: "Edit attempt",
        frequency: 1,
        lastSeen: now - (i * 5 * 60 * 1000), // 5 min apart
      }, true)
    }

    const rules = analyzeBehaviors(store)

    const retryRule = rules.find(r => r.pattern === "retry-loop" && r.filePath === "src/complex.ts")
    assert.ok(retryRule, "Should detect retry-loop pattern")
    assert.ok(retryRule.description.includes("retried"), "Should mention retry")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("analyzeBehaviors detects tool mismatches (Edit on binary files)", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Simulate failed Edit tool on a binary file
    const db = store.getDb()
    db.run(
      "INSERT INTO behavior_log (agent_type, action, file_path, success, metadata) VALUES (?, ?, ?, ?, ?)",
      ["auto", "tool:Edit", "assets/image.png", 0, "{}"]
    )
    db.run(
      "INSERT INTO behavior_log (agent_type, action, file_path, success, metadata) VALUES (?, ?, ?, ?, ?)",
      ["auto", "tool:Edit", "assets/image.png", 0, "{}"]
    )

    const rules = analyzeBehaviors(store)

    const toolMismatch = rules.find(r => r.pattern === "tool-mismatch" && r.filePath === "assets/image.png")
    assert.ok(toolMismatch, "Should detect tool-mismatch pattern")
    assert.ok(toolMismatch.description.includes("binary file"), "Should mention binary file")
    assert.ok(toolMismatch.description.includes("Edit"), "Should mention Edit tool")
    assert.equal(toolMismatch.suggestedPriority, "high", "Tool mismatch should be high priority")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("analyzeBehaviors detects success patterns", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Add multiple successful edits for the same file
    for (let i = 0; i < 4; i++) {
      store.logBehavior({
        id: `success-${i}`,
        path: "src/stable.ts",
        pattern: "edit-success",
        description: "Edit succeeded",
        frequency: 1,
        lastSeen: Date.now(),
      }, true)
    }

    const rules = analyzeBehaviors(store)

    const successRule = rules.find(r => r.pattern === "success-pattern" && r.filePath === "src/stable.ts")
    assert.ok(successRule, "Should detect success-pattern")
    assert.ok(successRule.description.includes("perfectly"), "Should mention perfect handling")
    assert.ok(successRule.confidence > 0.5, "Should have reasonable confidence")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("analyzeBehaviors returns pattern results with correct structure", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Add some failures
    for (let i = 0; i < 2; i++) {
      store.logBehavior({
        id: `test-${i}`,
        path: "src/test.ts",
        pattern: "test",
        description: "Test",
        frequency: 1,
        lastSeen: Date.now(),
      }, false)
    }

    const rules = analyzeBehaviors(store)

    assert.ok(Array.isArray(rules), "Should return array")

    if (rules.length > 0) {
      const rule = rules[0]
      assert.ok(typeof rule.filePath === "string", "Should have filePath string")
      assert.ok(typeof rule.pattern === "string", "Should have pattern string")
      assert.ok(typeof rule.description === "string", "Should have description string")
      assert.ok(typeof rule.confidence === "number", "Should have confidence number")
      assert.ok(Array.isArray(rule.evidence), "Should have evidence array")
      assert.ok(["critical", "high", "normal"].includes(rule.suggestedPriority), "Should have valid priority")
    }

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("analyzeBehaviors ignores single failures (need 2+)", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Only one failure - should not trigger
    store.logBehavior({
      id: "single-fail",
      path: "src/once.ts",
      pattern: "fail",
      description: "Failed once",
      frequency: 1,
      lastSeen: Date.now(),
    }, false)

    const rules = analyzeBehaviors(store)

    const failureRule = rules.find(r => r.filePath === "src/once.ts" && r.pattern === "frequent-failure")
    assert.ok(!failureRule, "Should not detect frequent-failure for single failure")
    store.close()
  } finally {
    cleanup(dir)
  }
})

test("analyzeBehaviors handles mixed success and failure", () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    // Mix of success and failure for same file
    for (let i = 0; i < 3; i++) {
      store.logBehavior({
        id: `mixed-s-${i}`,
        path: "src/mixed.ts",
        pattern: "edit",
        description: "Edit",
        frequency: 1,
        lastSeen: Date.now(),
      }, true)
    }

    for (let i = 0; i < 2; i++) {
      store.logBehavior({
        id: `mixed-f-${i}`,
        path: "src/mixed.ts",
        pattern: "edit",
        description: "Edit",
        frequency: 1,
        lastSeen: Date.now(),
      }, false)
    }

    const rules = analyzeBehaviors(store)

    // Should detect frequent failures (2 failures)
    const failureRule = rules.find(r => r.filePath === "src/mixed.ts" && r.pattern === "frequent-failure")
    assert.ok(failureRule, "Should detect failures in mixed scenario")

    // Should NOT detect success pattern (not all successful)
    const successRule = rules.find(r => r.filePath === "src/mixed.ts" && r.pattern === "success-pattern")
    assert.ok(!successRule, "Should not detect success pattern when there are failures")

    store.close()
  } finally {
    cleanup(dir)
  }
})
