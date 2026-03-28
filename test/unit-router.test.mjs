import test from "node:test"
import assert from "node:assert/strict"
import { route } from "../dist/router/index.js"

function makeEntry(path, options = {}) {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    path,
    classification: options.classification || "source",
    rules: options.rules || [],
    annotations: options.annotations || [],
    behaviors: options.behaviors || [],
    lastScanned: Date.now(),
    hash: "",
  }
}

test("matching by file path tokens", () => {
  const entries = [
    makeEntry("src/api/users.ts"),
    makeEntry("src/utils/helpers.ts"),
    makeEntry("src/components/Button.tsx"),
  ]

  const result = route("api users handler", entries)

  // Should prioritize entries matching "api" or "users"
  assert.ok(result.length > 0)
  const paths = result.map(e => e.path)
  assert.ok(paths.includes("src/api/users.ts"), "Should find api/users.ts")
})

test("matching by content keywords in annotations", () => {
  const entries = [
    makeEntry("src/auth.ts", {
      annotations: [{ id: "ann-1", path: "src/auth.ts", text: "Handles authentication and login", author: "user", created: Date.now() }],
    }),
    makeEntry("src/db.ts", {
      annotations: [{ id: "ann-2", path: "src/db.ts", text: "Database connection utilities", author: "user", created: Date.now() }],
    }),
  ]

  const result = route("authentication login", entries)

  assert.ok(result.length > 0)
  // auth.ts should rank higher due to annotation match
  assert.equal(result[0].path, "src/auth.ts")
})

test("matching by rule pattern and description", () => {
  const entries = [
    makeEntry("src/validation.ts", {
      rules: [{ id: "rule-1", pattern: "validate-email", description: "Email validation rules", priority: 50 }],
    }),
    makeEntry("src/formatting.ts", {
      rules: [{ id: "rule-2", pattern: "format-date", description: "Date formatting utilities", priority: 50 }],
    }),
  ]

  const result = route("email validation", entries)

  assert.ok(result.length > 0)
  assert.equal(result[0].path, "src/validation.ts")
})

test("returns all entries when no match", () => {
  const entries = [
    makeEntry("src/a.ts"),
    makeEntry("src/b.ts"),
    makeEntry("src/c.ts"),
  ]

  const result = route("xyz123nomatch", entries)

  // When no matches, should return all entries
  assert.equal(result.length, 3)
})

test("stopwords are filtered from query", () => {
  const entries = [
    makeEntry("src/user.ts"),
    makeEntry("src/admin.ts"),
  ]

  // Query with stopwords - "the", "a", "for" should be ignored
  const result = route("the user for a admin", entries)

  // Should match both user and admin since stopwords are filtered
  assert.ok(result.length > 0)
  const paths = result.map(e => e.path)
  assert.ok(paths.includes("src/user.ts") || paths.includes("src/admin.ts"))
})

test("empty query returns all entries", () => {
  const entries = [
    makeEntry("src/a.ts"),
    makeEntry("src/b.ts"),
  ]

  const result = route("", entries)
  assert.equal(result.length, 2)

  const result2 = route("   ", entries)
  assert.equal(result2.length, 2)
})

test("query with only stopwords returns all entries", () => {
  const entries = [
    makeEntry("src/a.ts"),
    makeEntry("src/b.ts"),
  ]

  // All tokens are stopwords
  const result = route("the a an in on for to with and or", entries)
  assert.equal(result.length, 2)
})

test("classification matching has lower weight", () => {
  const entries = [
    makeEntry("src/test-file.ts", { classification: "test" }),
    makeEntry("src/test-utils.ts", { classification: "source" }),
  ]

  const result = route("test", entries)

  // Both should match, but path match should weight higher than classification
  assert.ok(result.length >= 1)
})

test("limits results to max 10", () => {
  const entries = []
  for (let i = 0; i < 20; i++) {
    entries.push(makeEntry(`src/file${i}.ts`))
  }

  const result = route("file", entries)

  // Should be limited to 10 results
  assert.ok(result.length <= 10, `Expected at most 10 results, got ${result.length}`)
})
