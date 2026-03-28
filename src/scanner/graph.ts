import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DependencyGraph,
  DependencyNode,
  FileInfo,
} from "../types/index.js";

// match static import/require paths
const importRe = /(?:import\s+.*?from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const exportFromRe = /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;

const sourceExts = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
]);

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

function extractImports(content: string): string[] {
  const imports = new Set<string>();
  for (const re of [importRe, dynamicImportRe, exportFromRe]) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const spec = m[1];
      // skip node builtins and bare specifiers (no ./ or ../)
      if (!spec.startsWith(".")) continue;
      imports.add(spec);
    }
  }
  return [...imports];
}

// resolve relative import to file path
function resolveImport(
  fromFile: string,
  spec: string,
  allFiles: Set<string>,
): string | null {
  const normalized = norm(fromFile);
  const dir = normalized.includes("/")
    ? normalized.slice(0, normalized.lastIndexOf("/"))
    : "";
  const parts = dir ? dir.split("/") : [];

  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }

  const base = parts.join("/");

  // try exact match, then extensions
  if (allFiles.has(base)) return base;
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    const candidate = base + ext;
    if (allFiles.has(candidate)) return candidate;
  }
  // try index
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = `${base}/index${ext}`;
    if (allFiles.has(candidate)) return candidate;
  }
  return null;
}

export async function buildGraph(
  root: string,
  files: FileInfo[],
): Promise<DependencyGraph> {
  // Normalize all paths to forward slashes for consistent resolution
  const allPaths = new Set(files.map((f) => norm(f.path)));
  const nodes = new Map<string, DependencyNode>();

  // init all nodes
  for (const f of files) {
    const p = norm(f.path);
    const ext = p.slice(p.lastIndexOf("."));
    if (!sourceExts.has(ext)) continue;
    nodes.set(p, { path: p, imports: [], importedBy: [] });
  }

  // read + parse in chunks
  const sourceFiles = [...nodes.keys()];
  const chunkSize = 50;

  for (let i = 0; i < sourceFiles.length; i += chunkSize) {
    const chunk = sourceFiles.slice(i, i + chunkSize);
    const contents = await Promise.all(
      chunk.map(async (p) => {
        try {
          return await readFile(join(root, p), "utf-8");
        } catch {
          return null;
        }
      }),
    );

    for (let j = 0; j < chunk.length; j++) {
      const p = chunk[j];
      const content = contents[j];
      if (!content) continue;

      const specs = extractImports(content);
      const resolved: string[] = [];

      for (const spec of specs) {
        const target = resolveImport(p, spec, allPaths);
        if (target && nodes.has(target)) {
          resolved.push(target);
        }
      }

      const node = nodes.get(p)!;
      node.imports = resolved;

      // populate reverse edges
      for (const target of resolved) {
        nodes.get(target)!.importedBy.push(p);
      }
    }
  }

  // find roots (no importers) and orphans (no imports and no importers)
  const roots: string[] = [];
  const orphans: string[] = [];
  for (const [path, node] of nodes) {
    if (node.importedBy.length === 0) roots.push(path);
    if (node.imports.length === 0 && node.importedBy.length === 0)
      orphans.push(path);
  }

  return { nodes, roots, orphans };
}
