import { readFile } from "node:fs/promises"
import type { DependencyGraph, DependencyNode, FileInfo } from "../types/index.js"

// match static import/require paths
const importRe = /(?:import\s+.*?from|require\s*\(\s*)['"]([^'"]+)['"]/g
const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const exportFromRe = /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g

const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"])

function extractImports(content: string): string[] {
  const imports = new Set<string>()
  for (const re of [importRe, dynamicImportRe, exportFromRe]) {
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(content)) !== null) {
      const spec = m[1]
      // skip node builtins and bare specifiers (no ./ or ../)
      if (!spec.startsWith(".")) continue
      imports.add(spec)
    }
  }
  return [...imports]
}

// resolve relative import to file path
function resolveImport(fromFile: string, spec: string, allFiles: Set<string>): string | null {
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : ""
  const parts = dir ? dir.split("/") : []

  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop()
    else if (seg !== ".") parts.push(seg)
  }

  const base = parts.join("/")

  // try exact match, then extensions
  if (allFiles.has(base)) return base
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    const candidate = base + ext
    if (allFiles.has(candidate)) return candidate
  }
  // try index
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = `${base}/index${ext}`
    if (allFiles.has(candidate)) return candidate
  }
  return null
}

export async function buildGraph(root: string, files: FileInfo[]): Promise<DependencyGraph> {
  const allPaths = new Set(files.map(f => f.path))
  const nodes = new Map<string, DependencyNode>()

  // init all nodes
  for (const f of files) {
    const ext = f.path.slice(f.path.lastIndexOf("."))
    if (!sourceExts.has(ext)) continue
    nodes.set(f.path, { path: f.path, imports: [], importedBy: [] })
  }

  // read + parse in chunks
  const sourceFiles = [...nodes.keys()]
  const chunkSize = 50

  for (let i = 0; i < sourceFiles.length; i += chunkSize) {
    const chunk = sourceFiles.slice(i, i + chunkSize)
    const contents = await Promise.all(
      chunk.map(async (p) => {
        try {
          return await readFile(`${root}/${p}`, "utf-8")
        } catch {
          return null
        }
      })
    )

    for (let j = 0; j < chunk.length; j++) {
      const p = chunk[j]
      const content = contents[j]
      if (!content) continue

      const specs = extractImports(content)
      const resolved: string[] = []

      for (const spec of specs) {
        const target = resolveImport(p, spec, allPaths)
        if (target && nodes.has(target)) {
          resolved.push(target)
        }
      }

      const node = nodes.get(p)!
      node.imports = resolved

      // populate reverse edges
      for (const target of resolved) {
        nodes.get(target)!.importedBy.push(p)
      }
    }
  }

  // find roots (no importers) and orphans (no imports and no importers)
  const roots: string[] = []
  const orphans: string[] = []
  for (const [path, node] of nodes) {
    if (node.importedBy.length === 0) roots.push(path)
    if (node.imports.length === 0 && node.importedBy.length === 0) orphans.push(path)
  }

  return { nodes, roots, orphans }
}
