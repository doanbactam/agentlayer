import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { detectPatterns } from "../dist/scanner/patterns.js"

function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), "agentmind-patterns-"))
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

function createFileInfo(filePath, size = 100) {
  return {
    path: filePath,
    size,
    modified: Date.now(),
    hash: "test-hash",
  }
}

test("detectPatterns finds TODO comments", async () => {
  const dir = createTempDir()
  try {
    const content = `// TODO: implement this later
export function stub() {
  // FIXME: this is broken
  return null;
}`
    writeFileSync(path.join(dir, "code.ts"), content)

    const files = [createFileInfo("code.ts", content.length)]
    const patterns = await detectPatterns(dir, files)

    const todoPattern = patterns.find(p => p.pattern === "todo")
    assert.ok(todoPattern, "Should detect TODO pattern")
    assert.ok(todoPattern.reason.includes("TODO"), "Reason should mention TODO")

    const fixmePattern = patterns.find(p => p.pattern === "fixme")
    assert.ok(fixmePattern, "Should detect FIXME pattern")
    assert.ok(fixmePattern.reason.includes("FIXME"), "Reason should mention FIXME")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns finds custom scripts in package.json", async () => {
  const dir = createTempDir()
  try {
    const pkgContent = JSON.stringify({
      name: "test-project",
      scripts: {
        start: "node index.js",
        build: "tsc",
        "custom:deploy": "npm run build && deploy",
        "gen:types": "graphql-codegen",
      },
    })
    writeFileSync(path.join(dir, "package.json"), pkgContent)

    const files = []
    const patterns = await detectPatterns(dir, files)

    const customScriptPattern = patterns.find(p => p.pattern === "custom-script:custom:deploy")
    assert.ok(customScriptPattern, "Should detect custom script")

    const genScriptPattern = patterns.find(p => p.pattern === "custom-script:gen:types")
    assert.ok(genScriptPattern, "Should detect gen:types script")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns finds .env file as env-required pattern", async () => {
  const dir = createTempDir()
  try {
    const envContent = `DATABASE_URL=postgres://localhost
API_KEY=secret123
# This is a comment
DEBUG=true`
    writeFileSync(path.join(dir, ".env"), envContent)

    const files = []
    const patterns = await detectPatterns(dir, files)

    const envPattern = patterns.find(p => p.pattern === "env-required")
    assert.ok(envPattern, "Should detect env-required pattern")
    assert.ok(envPattern.path === ".env", "Path should be .env")
    assert.ok(envPattern.reason.includes("DATABASE_URL"), "Reason should include env var names")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns handles malformed package.json gracefully", async () => {
  const dir = createTempDir()
  try {
    // Invalid JSON
    writeFileSync(path.join(dir, "package.json"), `{ "name": "broken", invalid json }`)

    const files = []
    // Should not throw
    const patterns = await detectPatterns(dir, files)

    // Should not have any package.json patterns
    const pkgPatterns = patterns.filter(p => p.path === "package.json")
    assert.equal(pkgPatterns.length, 0, "Should have no patterns from malformed package.json")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns detects HACK comments", async () => {
  const dir = createTempDir()
  try {
    const content = `// HACK: workaround for bug
export function workaround() {
  return true;
}`
    writeFileSync(path.join(dir, "hack.ts"), content)

    const files = [createFileInfo("hack.ts", content.length)]
    const patterns = await detectPatterns(dir, files)

    const hackPattern = patterns.find(p => p.pattern === "hack")
    assert.ok(hackPattern, "Should detect HACK pattern")
    assert.ok(hackPattern.snippet.includes("HACK"), "Snippet should include HACK")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns detects deprecated markers", async () => {
  const dir = createTempDir()
  try {
    const content = `/**
 * @deprecated Use newFunction instead
 */
export function oldFunction() {}`
    writeFileSync(path.join(dir, "deprecated.ts"), content)

    const files = [createFileInfo("deprecated.ts", content.length)]
    const patterns = await detectPatterns(dir, files)

    const deprecatedPattern = patterns.find(p => p.pattern === "deprecated")
    assert.ok(deprecatedPattern, "Should detect deprecated marker")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns detects monorepo markers", async () => {
  const dir = createTempDir()
  try {
    writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'")

    const files = []
    const patterns = await detectPatterns(dir, files)

    const monorepoPattern = patterns.find(p => p.pattern === "monorepo")
    assert.ok(monorepoPattern, "Should detect monorepo pattern")
    assert.ok(monorepoPattern.reason.includes("pnpm workspace"), "Should mention pnpm workspace")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns detects package manager lock", async () => {
  const dir = createTempDir()
  try {
    const pkgContent = JSON.stringify({
      name: "test",
      packageManager: "bun@1.0.0",
    })
    writeFileSync(path.join(dir, "package.json"), pkgContent)
    writeFileSync(path.join(dir, "bun.lockb"), "")

    const files = []
    const patterns = await detectPatterns(dir, files)

    const pmPattern = patterns.find(p => p.pattern === "package-manager")
    assert.ok(pmPattern, "Should detect package-manager pattern")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns skips large files", async () => {
  const dir = createTempDir()
  try {
    // Create a file larger than MAX_SCAN_SIZE (200KB)
    const largeContent = "// TODO: fix this\n" + "x".repeat(250_000)
    writeFileSync(path.join(dir, "large.ts"), largeContent)

    const files = [{ path: "large.ts", size: largeContent.length, modified: Date.now(), hash: "test" }]
    const patterns = await detectPatterns(dir, files)

    // Should not scan the large file
    const todoPattern = patterns.find(p => p.pattern === "todo")
    assert.ok(!todoPattern, "Should not detect TODO in large file")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns detects barrel exports", async () => {
  const dir = createTempDir()
  try {
    mkdirSync(path.join(dir, "src"), { recursive: true })
    const content = `export * from "./a.js";
export * from "./b.js";
export * from "./c.js";
export * from "./d.js";`
    writeFileSync(path.join(dir, "src", "index.ts"), content)

    const files = [createFileInfo("src/index.ts", content.length)]
    const patterns = await detectPatterns(dir, files)

    const barrelPattern = patterns.find(p => p.pattern === "barrel-export")
    assert.ok(barrelPattern, "Should detect barrel-export pattern")
    assert.ok(barrelPattern.reason.includes("4 re-exports"), "Should mention re-export count")
  } finally {
    cleanup(dir)
  }
})

test("detectPatterns detects native module dependencies", async () => {
  const dir = createTempDir()
  try {
    const pkgContent = JSON.stringify({
      name: "test",
      dependencies: {
        "native-module": "1.0.0",
        "better-sqlite3": "^11.0.0",
      },
    })
    writeFileSync(path.join(dir, "package.json"), pkgContent)

    const files = []
    const patterns = await detectPatterns(dir, files)

    const nativePatterns = patterns.filter(p => p.pattern === "native-module")
    assert.ok(nativePatterns.length >= 1, "Should detect native module dependencies")
  } finally {
    cleanup(dir)
  }
})
