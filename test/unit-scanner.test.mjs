import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildGraph } from "../dist/scanner/graph.js"

function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), "agentmind-scanner-"))
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

function createFileInfo(filePath, content) {
  return {
    path: filePath,
    size: Buffer.byteLength(content, "utf-8"),
    modified: Date.now(),
    hash: "test-hash",
  }
}

test("buildGraph identifies import relationships between files", async () => {
  const dir = createTempDir()
  try {
    // Create files with import relationships
    // Using bare imports (no extension) - resolver will try adding .ts extension
    const utilContent = `export function helper() { return 1; }`
    const mainContent = `import { helper } from "./utils";
export function main() { return helper(); }`
    const appContent = `import { main } from "./main";
console.log(main());`

    writeFileSync(path.join(dir, "utils.ts"), utilContent)
    writeFileSync(path.join(dir, "main.ts"), mainContent)
    writeFileSync(path.join(dir, "app.ts"), appContent)

    const files = [
      createFileInfo("utils.ts", utilContent),
      createFileInfo("main.ts", mainContent),
      createFileInfo("app.ts", appContent),
    ]

    const graph = await buildGraph(dir, files)

    assert.ok(graph.nodes.has("main.ts"), "main.ts should be in graph")
    assert.ok(graph.nodes.has("utils.ts"), "utils.ts should be in graph")
    assert.ok(graph.nodes.has("app.ts"), "app.ts should be in graph")

    // Check main.ts imports utils.ts
    const mainNode = graph.nodes.get("main.ts")
    assert.ok(mainNode.imports.includes("utils.ts"), "main.ts should import utils.ts")

    // Check utils.ts is imported by main.ts
    const utilsNode = graph.nodes.get("utils.ts")
    assert.ok(utilsNode.importedBy.includes("main.ts"), "utils.ts should be imported by main.ts")

    // Check app.ts imports main.ts
    const appNode = graph.nodes.get("app.ts")
    assert.ok(appNode.imports.includes("main.ts"), "app.ts should import main.ts")
  } finally {
    cleanup(dir)
  }
})

test("buildGraph detects orphan files with no imports or exports", async () => {
  const dir = createTempDir()
  try {
    // Create an orphan file (no imports, no exports)
    const orphanContent = `const x = 1;
console.log(x);`
    // Create a connected file
    const connectedContent = `export const y = 2;`

    writeFileSync(path.join(dir, "orphan.ts"), orphanContent)
    writeFileSync(path.join(dir, "connected.ts"), connectedContent)

    const files = [
      createFileInfo("orphan.ts", orphanContent),
      createFileInfo("connected.ts", connectedContent),
    ]

    const graph = await buildGraph(dir, files)

    assert.ok(graph.orphans.includes("orphan.ts"), "orphan.ts should be detected as orphan")
    // connected.ts is also orphan because no one imports it and it doesn't import anything
    assert.ok(graph.orphans.length >= 1, "Should have at least one orphan")
  } finally {
    cleanup(dir)
  }
})

test("buildGraph handles missing imports gracefully", async () => {
  const dir = createTempDir()
  try {
    // File that imports a non-existent file
    const content = `import { missing } from "./does-not-exist";
export function foo() { return missing; }`

    writeFileSync(path.join(dir, "broken.ts"), content)

    const files = [createFileInfo("broken.ts", content)]

    const graph = await buildGraph(dir, files)

    // Should not throw, and should have the file in the graph
    assert.ok(graph.nodes.has("broken.ts"), "broken.ts should be in graph")

    // The import should be empty since the target doesn't exist
    const node = graph.nodes.get("broken.ts")
    assert.equal(node.imports.length, 0, "Should have no resolved imports for missing file")
  } finally {
    cleanup(dir)
  }
})

test("buildGraph handles index file imports", async () => {
  const dir = createTempDir()
  try {
    mkdirSync(path.join(dir, "lib"), { recursive: true })

    // Using bare imports without .js extension
    const indexContent = `export { foo } from "./foo";
export { bar } from "./bar";`
    const fooContent = `export function foo() { return "foo"; }`
    const barContent = `export function bar() { return "bar"; }`
    const mainContent = `import { foo, bar } from "./lib/index";`

    writeFileSync(path.join(dir, "lib", "index.ts"), indexContent)
    writeFileSync(path.join(dir, "lib", "foo.ts"), fooContent)
    writeFileSync(path.join(dir, "lib", "bar.ts"), barContent)
    writeFileSync(path.join(dir, "main.ts"), mainContent)

    const files = [
      createFileInfo("lib/index.ts", indexContent),
      createFileInfo("lib/foo.ts", fooContent),
      createFileInfo("lib/bar.ts", barContent),
      createFileInfo("main.ts", mainContent),
    ]

    const graph = await buildGraph(dir, files)

    // main.ts should import lib/index.ts
    const mainNode = graph.nodes.get("main.ts")
    assert.ok(mainNode.imports.includes("lib/index.ts"), "main.ts should import lib/index.ts")

    // lib/index.ts should import lib/foo.ts and lib/bar.ts
    const indexNode = graph.nodes.get("lib/index.ts")
    assert.ok(indexNode.imports.includes("lib/foo.ts"), "index.ts should import foo.ts")
    assert.ok(indexNode.imports.includes("lib/bar.ts"), "index.ts should import bar.ts")
  } finally {
    cleanup(dir)
  }
})

test("buildGraph skips non-source files", async () => {
  const dir = createTempDir()
  try {
    const tsContent = `export const x = 1;`
    const jsonContent = `{"name": "test"}`

    writeFileSync(path.join(dir, "code.ts"), tsContent)
    writeFileSync(path.join(dir, "data.json"), jsonContent)

    const files = [
      createFileInfo("code.ts", tsContent),
      createFileInfo("data.json", jsonContent),
    ]

    const graph = await buildGraph(dir, files)

    assert.ok(graph.nodes.has("code.ts"), "code.ts should be in graph")
    assert.ok(!graph.nodes.has("data.json"), "data.json should NOT be in graph")
  } finally {
    cleanup(dir)
  }
})

test("buildGraph identifies roots (files with no importers)", async () => {
  const dir = createTempDir()
  try {
    // Using bare imports without .js extension
    const libContent = `export function lib() {}`
    const mainContent = `import { lib } from "./lib";
export function main() { lib(); }`
    const entryContent = `import { main } from "./main";
main();`

    writeFileSync(path.join(dir, "lib.ts"), libContent)
    writeFileSync(path.join(dir, "main.ts"), mainContent)
    writeFileSync(path.join(dir, "entry.ts"), entryContent)

    const files = [
      createFileInfo("lib.ts", libContent),
      createFileInfo("main.ts", mainContent),
      createFileInfo("entry.ts", entryContent),
    ]

    const graph = await buildGraph(dir, files)

    // entry.ts is a root because nothing imports it
    assert.ok(graph.roots.includes("entry.ts"), "entry.ts should be a root")

    // lib.ts is not a root because main.ts imports it
    assert.ok(!graph.roots.includes("lib.ts"), "lib.ts should not be a root")
  } finally {
    cleanup(dir)
  }
})
