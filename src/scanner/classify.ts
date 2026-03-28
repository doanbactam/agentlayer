import { glob } from "glob"
import { stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { FileInfo, FileClassification } from "../types/index.js"

type Matcher = [RegExp, FileClassification]

const pathMatchers: Matcher[] = [
  // generated / vendor first — broadest exclusions
  [/(^|\/)node_modules\//, "vendor"],
  [/\.agentmind\//, "generated"],
  [/(^|\/)(dist|\.next|coverage|build|out|\.output)\//, "build"],
  [/\.min\.(js|css)$/, "generated"],

  // test
  [/(^|\/)(__tests__|test|tests|spec|specs)\//, "test"],
  [/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/, "test"],
  [/_test\.(go|rs)$/, "test"],

  // docs
  [/\.md$/, "docs"],
  [/(^|\/)docs\//, "docs"],
  [/LICENSE|CHANGELOG|CONTRIBUTING/, "docs"],

  // style
  [/\.(css|scss|sass|less|styled|module\.css)$/, "asset"],

  // config (must come before data so package.json etc. are caught first)
  [/\.config\.(ts|js|mjs|cjs)$/, "config"],
  [/^\.github\//, "config"],
  [/^Dockerfile/, "config"],
  [/^docker-compose/, "config"],
  [/^tsconfig/, "config"],
  [/^\.env/, "config"],
  [/\.(lock|lockfile)$/, "config"],
  [/^(package\.json|turbo\.json|nx\.json|lerna\.json|pnpm-workspace\.yaml)$/, "config"],

  // data
  [/\.(json|yaml|yml|toml|xml|csv|proto|graphql|gql)$/, "data"],
  [/\.(sql|prisma|drizzle)$/, "data"],

  // images, fonts, binaries
  [/\.(png|jpg|jpeg|gif|svg|ico|webp|avif|mp4|mp3|woff2?|ttf|eot)$/, "asset"],
]

const sourceExts = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp",
  ".cs", ".scala", ".clj", ".ex", ".exs", ".erl", ".hs", ".ml", ".vim", ".el",
  ".sh", ".bash", ".zsh", ".fish",
  ".html", ".htm", ".vue", ".svelte",
  ".zig", ".nim", ".lua", ".php",
])

function classifyPath(p: string): FileClassification {
  // Normalize to forward slashes for consistent regex matching on Windows
  const normalized = p.replace(/\\/g, "/")
  for (const [re, cls] of pathMatchers) {
    if (re.test(normalized)) return cls
  }
  const ext = p.slice(p.lastIndexOf("."))
  if (sourceExts.has(ext)) return "source"
  // index files in root
  if (/(^|\/)index\.(ts|js|mjs)$/.test(p)) return "source"
  return "data"
}

async function hashFile(p: string): Promise<string> {
  try {
    const buf = await readFile(p)
    return createHash("sha256").update(buf).digest("hex").slice(0, 12)
  } catch {
    // File may have been deleted or is inaccessible after glob - return empty hash as fallback
    return ""
  }
}

export async function classify(root: string): Promise<{ files: FileInfo[]; classifications: Map<string, FileClassification> }> {
  const entries = await glob("**/*", {
    cwd: root,
    ignore: [
      "node_modules/**",
      ".git/**",
      "dist/**",
      ".next/**",
      "coverage/**",
      ".agentmind/**",
    ],
    nodir: true,
    dot: true,
    absolute: false,
  })

  const classifications = new Map<string, FileClassification>()
  const files: FileInfo[] = []

  // batch stat + hash
  const results = await Promise.allSettled(
    entries.map(async (p) => {
      const full = `${root}/${p}`
      const [s, hash] = await Promise.all([
        stat(full),
        hashFile(full),
      ])
      return { path: p, size: s.size, modified: s.mtimeMs, hash }
    })
  )

  for (const r of results) {
    if (r.status !== "fulfilled") continue
    const f = r.value
    files.push(f)
    classifications.set(f.path.replace(/\\/g, "/"), classifyPath(f.path))
  }

  return { files, classifications }
}
