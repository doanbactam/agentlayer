import test from "node:test"
import assert from "node:assert/strict"
import { classify } from "../dist/scanner/classify.js"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

function createTempProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmind-classify-"))
  mkdirSync(path.join(dir, "src"), { recursive: true })
  mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true })
  mkdirSync(path.join(dir, "test"), { recursive: true })
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

// Normalize path to forward slashes for cross-platform comparison
function norm(p) {
  return p.replace(/\\/g, "/")
}

test(".ts files classified as source", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "src", "index.ts"), "export const x = 1")
    const { files, classifications } = await classify(dir)

    const tsFile = files.find(f => norm(f.path) === "src/index.ts")
    assert.ok(tsFile, "Should find ts file")
    assert.equal(classifications.get(norm(tsFile.path)), "source")
  } finally {
    cleanup(dir)
  }
})

test(".test.ts files classified as test", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "src", "utils.test.ts"), "test('x', () => {})")
    const { files, classifications } = await classify(dir)

    const f = files.find(f => norm(f.path) === "src/utils.test.ts")
    assert.ok(f, "Should find test file")
    assert.equal(classifications.get(norm(f.path)), "test")
  } finally {
    cleanup(dir)
  }
})

test("node_modules files classified as vendor", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "node_modules", "pkg", "index.js"), "module.exports = {}")
    const { files, classifications } = await classify(dir)

    const nodeModulesFile = files.find(f => norm(f.path).includes("node_modules"))
    if (nodeModulesFile) {
      assert.equal(classifications.get(norm(nodeModulesFile.path)), "vendor")
    } else {
      assert.ok(true, "node_modules correctly ignored by glob")
    }
  } finally {
    cleanup(dir)
  }
})

test(".env files classified as config", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, ".env"), "API_KEY=secret")
    const { files, classifications } = await classify(dir)

    const f = files.find(f => norm(f.path) === ".env")
    assert.ok(f, "Should find .env file")
    assert.equal(classifications.get(norm(f.path)), "config")
  } finally {
    cleanup(dir)
  }
})

test("README.md classified as docs", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "README.md"), "# Project")
    const { files, classifications } = await classify(dir)

    const f = files.find(f => norm(f.path) === "README.md")
    assert.ok(f, "Should find README.md")
    assert.equal(classifications.get(norm(f.path)), "docs")
  } finally {
    cleanup(dir)
  }
})

test("files in test directory classified as test", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "test", "helper.ts"), "export function help() {}")
    const { files, classifications } = await classify(dir)

    const f = files.find(f => norm(f.path) === "test/helper.ts")
    assert.ok(f, "Should find test/helper.ts")
    assert.equal(classifications.get(norm(f.path)), "test")
  } finally {
    cleanup(dir)
  }
})

test(".spec.js files classified as test", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "src", "api.spec.js"), "describe('api', () => {})")
    const { files, classifications } = await classify(dir)

    const f = files.find(f => norm(f.path) === "src/api.spec.js")
    assert.ok(f, "Should find spec file")
    assert.equal(classifications.get(norm(f.path)), "test")
  } finally {
    cleanup(dir)
  }
})

test("package.json classified as config", async () => {
  const dir = createTempProject()
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test" }))
    const { files, classifications } = await classify(dir)

    const f = files.find(f => norm(f.path) === "package.json")
    assert.ok(f, "Should find package.json")
    assert.equal(classifications.get(norm(f.path)), "config")
  } finally {
    cleanup(dir)
  }
})
