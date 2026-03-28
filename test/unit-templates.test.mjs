import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ContextStore } from "../dist/store/schema.js"
import { listTemplates, getTemplate, applyTemplate, autoApplyTemplates } from "../dist/templates/index.js"

function createTempProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmind-templates-"))
  mkdirSync(path.join(dir, ".agentmind"), { recursive: true })
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

test("listTemplates returns available templates", () => {
  const templates = listTemplates()

  assert.ok(Array.isArray(templates), "should return an array")
  assert.ok(templates.length > 0, "should have at least one template")

  const names = templates.map(t => t.name)
  assert.ok(names.includes("nextjs"), "should include nextjs template")
  assert.ok(names.includes("python"), "should include python template")
  assert.ok(names.includes("go"), "should include go template")
  assert.ok(names.includes("rust"), "should include rust template")
})

test("template has expected structure", () => {
  const template = getTemplate("nextjs")

  assert.ok(template, "nextjs template should exist")
  assert.equal(template.name, "nextjs", "name should be nextjs")
  assert.ok(template.description, "should have description")
  assert.ok(Array.isArray(template.patterns), "should have patterns array")
  assert.ok(Array.isArray(template.rules), "should have rules array")
})

test("template rule has pattern and description", () => {
  const template = getTemplate("nextjs")

  assert.ok(template.rules.length > 0, "should have at least one rule")

  const rule = template.rules[0]
  assert.ok(rule.pattern, "rule should have pattern")
  assert.ok(rule.description, "rule should have description")
  assert.ok(["critical", "high", "normal", "low"].includes(rule.priority), "rule should have valid priority")
})

test("getTemplate returns undefined for unknown template", () => {
  const template = getTemplate("unknown-template")
  assert.equal(template, undefined, "should return undefined for unknown template")
})

test("nextjs template detects next.config.*", () => {
  const template = getTemplate("nextjs")

  const detectPatterns = template.patterns.filter(p => p.glob === "next.config.*")
  assert.ok(detectPatterns.length > 0, "should have next.config.* pattern")
})

test("applyTemplate throws for unknown template", async () => {
  const dir = createTempProject()
  try {
    const store = new ContextStore(dir)

    await assert.rejects(
      async () => applyTemplate("unknown-template", dir, store),
      /Unknown template/,
      "should throw for unknown template"
    )

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("applyTemplate adds rules for matching files", async () => {
  const dir = createTempProject()
  try {
    // Create a next.config.js file
    writeFileSync(path.join(dir, "next.config.js"), "export default {}")

    const store = new ContextStore(dir)
    const result = await applyTemplate("nextjs", dir, store)

    assert.ok(result.rulesAdded >= 1, "should add at least one rule")
    assert.ok(result.patternsMatched >= 1, "should match at least one file")

    const entries = store.getEntries({ type: "rule" })
    assert.ok(entries.length >= 1, "store should have rules")

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("applyTemplate skips patterns with no matches", async () => {
  const dir = createTempProject()
  try {
    // Empty project - no files matching any template patterns
    const store = new ContextStore(dir)
    const result = await applyTemplate("nextjs", dir, store)

    assert.equal(result.rulesAdded, 0, "should add no rules")
    assert.ok(result.skipped.length > 0, "should skip some patterns")

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("applyTemplate is idempotent", async () => {
  const dir = createTempProject()
  try {
    // Create a next.config.js file
    writeFileSync(path.join(dir, "next.config.js"), "export default {}")

    const store = new ContextStore(dir)

    // Apply twice
    const result1 = await applyTemplate("nextjs", dir, store)
    const result2 = await applyTemplate("nextjs", dir, store)

    // Second application should add 0 rules (already exists)
    assert.ok(result1.rulesAdded >= 1, "first apply should add rules")
    assert.equal(result2.rulesAdded, 0, "second apply should add no rules")

    const entries = store.getEntries({ type: "rule" })
    // Should still have the original rules, not duplicated
    assert.ok(entries.length === result1.rulesAdded, "rules should not be duplicated")

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("applyTemplate sets template metadata", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "next.config.js"), "export default {}")

    const store = new ContextStore(dir)
    await applyTemplate("nextjs", dir, store)

    const meta = store.getMeta("template:nextjs")
    assert.ok(meta, "should set template metadata")
    assert.ok(new Date(meta).getTime() > 0, "metadata should be valid date")

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("autoApplyTemplates detects and applies matching templates", async () => {
  const dir = createTempProject()
  try {
    // Create a next.config.js file (triggers nextjs template)
    writeFileSync(path.join(dir, "next.config.js"), "export default {}")

    const store = new ContextStore(dir)
    const results = await autoApplyTemplates(dir, store)

    assert.ok(results.has("nextjs"), "should detect nextjs template")
    assert.ok(results.get("nextjs").rulesAdded >= 1, "should add rules for nextjs")

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("autoApplyTemplates returns empty map for unrecognized project", async () => {
  const dir = createTempProject()
  try {
    // Empty project with no recognizable config files
    const store = new ContextStore(dir)
    const results = await autoApplyTemplates(dir, store)

    assert.equal(results.size, 0, "should not detect any templates")

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("python template detects pyproject.toml", () => {
  const template = getTemplate("python")

  assert.ok(template, "python template should exist")
  const detectPatterns = template.patterns.filter(p => p.glob === "pyproject.toml")
  assert.ok(detectPatterns.length > 0, "should have pyproject.toml pattern")
})

test("go template detects go.mod", () => {
  const template = getTemplate("go")

  assert.ok(template, "go template should exist")
  const detectPatterns = template.patterns.filter(p => p.glob === "go.mod")
  assert.ok(detectPatterns.length > 0, "should have go.mod pattern")
})

test("rust template detects Cargo.toml", () => {
  const template = getTemplate("rust")

  assert.ok(template, "rust template should exist")
  const detectPatterns = template.patterns.filter(p => p.glob === "Cargo.toml")
  assert.ok(detectPatterns.length > 0, "should have Cargo.toml pattern")
})

test("sst template detects sst.config.ts", () => {
  const template = getTemplate("sst")

  assert.ok(template, "sst template should exist")
  const detectPatterns = template.patterns.filter(p => p.glob === "sst.config.ts")
  assert.ok(detectPatterns.length > 0, "should have sst.config.ts pattern")
})

test("react-native template detects app layouts", () => {
  const template = getTemplate("react-native")

  assert.ok(template, "react-native template should exist")
  const layoutPatterns = template.patterns.filter(p => p.glob.includes("_layout.tsx"))
  assert.ok(layoutPatterns.length > 0, "should have _layout.tsx pattern")
})

test("applyTemplate with go project", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "go.mod"), "module example.com/test\n\ngo 1.21")

    const store = new ContextStore(dir)
    const result = await applyTemplate("go", dir, store)

    assert.ok(result.rulesAdded >= 1, "should add at least one rule")

    store.close()
  } finally {
    cleanup(dir)
  }
})

test("applyTemplate with rust project", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "Cargo.toml"), "[package]\nname = \"test\"")

    const store = new ContextStore(dir)
    const result = await applyTemplate("rust", dir, store)

    assert.ok(result.rulesAdded >= 1, "should add at least one rule")

    store.close()
  } finally {
    cleanup(dir)
  }
})
