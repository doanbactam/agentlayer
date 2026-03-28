import chalk from "chalk"
import fs from "node:fs"
import path from "node:path"
import { classify } from "../../scanner/classify.js"
import { ContextStore } from "../../store/schema.js"
import type { FileClassification, FileInfo } from "../../types/index.js"

// ── Types ──────────────────────────────────────────────

interface DirCoverage {
  dir: string
  total: number
  covered: number
  pct: number
}

interface ClassificationCount {
  type: FileClassification
  count: number
}

interface StaleEntry {
  path: string
  daysAgo: number
}

interface BehaviorSummary {
  successRate: number
  totalSuccesses: number
  totalEvents: number
  mostEdited: { path: string; edits: number } | null
  mostFailed: { path: string; failures: number } | null
}

interface Recommendation {
  message: string
  priority: "high" | "medium" | "low"
}

interface HealthData {
  dirCoverage: DirCoverage[]
  classifications: ClassificationCount[]
  totalFiles: number
  stale: StaleEntry[]
  behavior: BehaviorSummary | null
  recommendations: Recommendation[]
}

// ── Main ───────────────────────────────────────────────

export async function health(opts: { json?: boolean }): Promise<void> {
  const cwd = process.cwd()
  const agentlayerDir = path.join(cwd, ".agentlayer")
  const dbPath = path.join(agentlayerDir, "context.db")

  if (!fs.existsSync(agentlayerDir)) {
    console.error(chalk.red("\n  agentlayer is not initialized in this project."))
    console.error(chalk.gray("  Run `agentlayer init` first.\n"))
    process.exit(1)
  }

  if (!fs.existsSync(dbPath)) {
    console.error(chalk.yellow("\n  No context store found. Run `agentlayer scan` first.\n"))
    process.exit(1)
  }

  const store = new ContextStore(cwd)
  const db = store.getDb()
  const scan = await classify(cwd)

  const data: HealthData = {
    dirCoverage: [],
    classifications: [],
    totalFiles: 0,
    stale: [],
    behavior: null,
    recommendations: [],
  }

  try {
    // ── Section 1: Directory coverage ──
    data.dirCoverage = computeDirCoverage(scan.files, scan.classifications, db)

    // ── Section 2: File classification ──
    const classificationResult = computeClassifications(scan.classifications)
    data.classifications = classificationResult.counts
    data.totalFiles = classificationResult.total

    // ── Section 3: Staleness ──
    data.stale = computeStaleness(db)

    // ── Section 4: Behavior ──
    data.behavior = computeBehavior(db)

    // ── Section 5: Recommendations ──
    data.recommendations = computeRecommendations(data)
  } finally {
    store.close()
  }

  if (opts.json) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  renderDashboard(data)
}

// ── Data queries ───────────────────────────────────────

function computeDirCoverage(
  files: FileInfo[],
  classifications: Map<string, FileClassification>,
  db: ReturnType<ContextStore["getDb"]>,
): DirCoverage[] {
  const rows = db.query(`
    SELECT DISTINCT file_path
    FROM context_entries
    WHERE type IN ('rule', 'annotation')
      AND file_path IS NOT NULL AND file_path != ''
  `).all() as Array<{ file_path: string }>

  const coveredPaths = new Set(rows.map((row) => row.file_path.replace(/\\/g, "/")))
  const dirMap = new Map<string, { total: Set<string>; covered: Set<string> }>()

  for (const file of files) {
    const cls = classifications.get(file.path) ?? "data"
    if (cls === "vendor" || cls === "generated" || cls === "build") continue

    const dir = extractDir(file.path)
    if (!dir) continue

    let bucket = dirMap.get(dir)
    if (!bucket) {
      bucket = { total: new Set(), covered: new Set() }
      dirMap.set(dir, bucket)
    }

    bucket.total.add(file.path)
    if (coveredPaths.has(file.path)) {
      bucket.covered.add(file.path)
    }
  }

  const results: DirCoverage[] = []
  for (const [dir, counts] of dirMap) {
    const total = counts.total.size
    const covered = counts.covered.size
    results.push({
      dir,
      total,
      covered,
      pct: total > 0 ? Math.round((covered / total) * 100) : 0,
    })
  }

  // Sort: lowest coverage first (most actionable)
  results.sort((a, b) => a.pct - b.pct || b.total - a.total)

  return results
}

function computeClassifications(classifications: Map<string, FileClassification>): {
  counts: ClassificationCount[]
  total: number
} {
  const counts = new Map<FileClassification, number>()
  let total = 0

  for (const cls of classifications.values()) {
    if (cls === "vendor" || cls === "generated" || cls === "build") continue
    counts.set(cls, (counts.get(cls) ?? 0) + 1)
    total++
  }

  // Add zero-count types for display
  const allTypes: FileClassification[] = ["source", "data", "config", "test", "docs", "asset", "build", "generated", "vendor"]
  for (const t of allTypes) {
    if (!counts.has(t)) counts.set(t, 0)
  }

  const sorted = [...counts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }))

  // Append zero-count types that are commonly interesting
  const displayTypes = new Set(sorted.map((s) => s.type))
  for (const t of ["test", "docs"] as FileClassification[]) {
    if (!displayTypes.has(t) && counts.get(t) === 0) {
      sorted.push({ type: t, count: 0 })
    }
  }

  return { counts: sorted, total }
}

function computeStaleness(db: ReturnType<ContextStore["getDb"]>): StaleEntry[] {
  const rows = db.query(`
    SELECT
      file_path,
      CAST(julianday('now') - julianday(updated_at) AS INTEGER) AS days_ago
    FROM context_entries
    WHERE type IN ('rule', 'annotation')
      AND file_path IS NOT NULL AND file_path != ''
      AND updated_at < datetime('now', '-30 days')
    GROUP BY file_path
    ORDER BY days_ago DESC
  `).all() as Array<{ file_path: string; days_ago: number }>

  return rows.map((r) => ({
    path: r.file_path,
    daysAgo: r.days_ago,
  }))
}

function computeBehavior(db: ReturnType<ContextStore["getDb"]>): BehaviorSummary | null {
  const totalRow = db.query(`
    SELECT COUNT(*) as c FROM behavior_log
    WHERE timestamp >= datetime('now', '-7 days')
  `).get() as { c: number }

  if (totalRow.c === 0) return null

  const successRow = db.query(`
    SELECT SUM(success) as s FROM behavior_log
    WHERE timestamp >= datetime('now', '-7 days')
  `).get() as { s: number | null }

  const totalEvents = totalRow.c
  const totalSuccesses = successRow.s ?? 0
  const successRate = totalEvents > 0 ? totalSuccesses / totalEvents : 0

  // Most edited file
  const mostEditedRow = db.query(`
    SELECT file_path, COUNT(*) as edits
    FROM behavior_log
    WHERE timestamp >= datetime('now', '-7 days')
      AND file_path IS NOT NULL AND file_path != ''
    GROUP BY file_path
    ORDER BY edits DESC
    LIMIT 1
  `).get() as { file_path: string; edits: number } | null

  // Most failed file
  const mostFailedRow = db.query(`
    SELECT file_path, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
    FROM behavior_log
    WHERE timestamp >= datetime('now', '-7 days')
      AND file_path IS NOT NULL AND file_path != ''
    GROUP BY file_path
    HAVING failures > 0
    ORDER BY failures DESC
    LIMIT 1
  `).get() as { file_path: string; failures: number } | null

  return {
    successRate,
    totalSuccesses,
    totalEvents,
    mostEdited: mostEditedRow ? { path: mostEditedRow.file_path, edits: mostEditedRow.edits } : null,
    mostFailed: mostFailedRow ? { path: mostFailedRow.file_path, failures: mostFailedRow.failures } : null,
  }
}

function computeRecommendations(data: HealthData): Recommendation[] {
  const recs: Recommendation[] = []

  // Directories with 0% coverage
  const zeroCoverage = data.dirCoverage.filter((d) => d.pct === 0)
  for (const d of zeroCoverage.slice(0, 3)) {
    recs.push({
      message: `Annotate ${d.dir} (0% coverage, ${d.total} file${d.total !== 1 ? "s" : ""})`,
      priority: "high",
    })
  }

  // Directories with low coverage (< 50%)
  const lowCoverage = data.dirCoverage.filter((d) => d.pct > 0 && d.pct < 50)
  for (const d of lowCoverage.slice(0, 2)) {
    recs.push({
      message: `Improve coverage in ${d.dir} (${d.pct}%, ${d.covered}/${d.total} files)`,
      priority: "medium",
    })
  }

  // Files with failures
  if (data.behavior?.mostFailed) {
    const mf = data.behavior.mostFailed
    recs.push({
      message: `Fix failures in ${mf.path} (${mf.failures} failure${mf.failures !== 1 ? "s" : ""})`,
      priority: "high",
    })
  }

  // Stale entries
  if (data.stale.length > 0) {
    const topStale = data.stale[0]
    recs.push({
      message: `Rescan stale entries (${data.stale.length} file${data.stale.length !== 1 ? "s" : ""} not updated in 30+ days, oldest: ${topStale.path})`,
      priority: "low",
    })
  }

  return recs
}

// ── Rendering ──────────────────────────────────────────

function renderDashboard(data: HealthData): void {
  const W = 55
  const hr = chalk.gray("  " + "\u2500".repeat(W))

  console.log("")
  console.log(chalk.bold("  agentlayer health"))
  console.log(hr)
  console.log("")

  renderCoverage(data.dirCoverage)
  console.log("")
  renderClassifications(data.classifications, data.totalFiles)
  console.log("")
  renderStaleness(data.stale)
  console.log("")
  renderBehavior(data.behavior)
  console.log("")
  renderRecommendations(data.recommendations)
  console.log("")
}

function renderCoverage(dirs: DirCoverage[]): void {
  console.log(chalk.bold("  Coverage by directory"))
  console.log(chalk.gray("  " + "\u2500".repeat(55)))

  if (dirs.length === 0) {
    console.log(chalk.dim("  No files in context store yet."))
    return
  }

  const maxBarWidth = 18
  const maxDirLen = Math.max(...dirs.map((d) => d.dir.length), 5)

  for (const d of dirs) {
    const colorFn =
      d.pct >= 80 ? chalk.green
      : d.pct >= 50 ? chalk.yellow
      : d.pct > 0 ? chalk.red
      : chalk.dim

    const filled = Math.round((d.pct / 100) * maxBarWidth)
    const empty = maxBarWidth - filled
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty)

    const dirLabel = d.dir.padEnd(maxDirLen)
    const pctLabel = String(d.pct).padStart(3) + "%"
    const fileLabel = `${d.covered}/${d.total} files`

    console.log(`  ${chalk.dim(dirLabel)}  ${colorFn(bar)}  ${colorFn(pctLabel)}  ${chalk.dim(fileLabel)}`)
  }
}

function renderClassifications(counts: ClassificationCount[], total: number): void {
  console.log(chalk.bold("  File types"))
  console.log(chalk.gray("  " + "\u2500".repeat(55)))

  if (counts.length === 0) {
    console.log(chalk.dim("  No classified files yet."))
    return
  }

  const maxCount = Math.max(...counts.map((c) => c.count), 1)
  const maxBarWidth = 28
  const maxLabelLen = Math.max(...counts.map((c) => c.type.length), 4)

  for (const c of counts) {
    const pct = total > 0 ? Math.round((c.count / total) * 100) : 0
    const filled = Math.round((c.count / maxCount) * maxBarWidth)
    const empty = maxBarWidth - filled
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty)

    const label = c.type.padEnd(maxLabelLen)
    const numLabel = String(c.count).padStart(3)
    const pctLabel = `(${pct}%)`

    console.log(`  ${chalk.dim(label)}  ${chalk.cyan(bar)}  ${chalk.bold(numLabel)}  ${chalk.dim(pctLabel)}`)
  }
}

function renderStaleness(stale: StaleEntry[]): void {
  console.log(chalk.bold("  Stale entries (not updated in 30+ days)"))
  console.log(chalk.gray("  " + "\u2500".repeat(55)))

  if (stale.length === 0) {
    console.log(chalk.green("  (none \u2014 all fresh!)"))
    return
  }

  const maxPathLen = Math.min(Math.max(...stale.map((s) => s.path.length)), 40)

  for (const s of stale) {
    const displayPath = s.path.length > 40 ? "..." + s.path.slice(-37) : s.path
    const daysLabel = `${s.daysAgo} day${s.daysAgo !== 1 ? "s" : ""} ago`
    console.log(`  ${chalk.yellow("\u26A0")} ${displayPath.padEnd(maxPathLen)}  ${chalk.dim("last updated " + daysLabel)}`)
  }
}

function renderBehavior(behavior: BehaviorSummary | null): void {
  console.log(chalk.bold("  Agent behavior (last 7 days)"))
  console.log(chalk.gray("  " + "\u2500".repeat(55)))

  if (!behavior) {
    console.log(chalk.dim("  No behavior data recorded yet."))
    return
  }

  const pct = Math.round(behavior.successRate * 100)
  const colorFn = pct >= 80 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red
  console.log(`  Success rate: ${colorFn(pct + "%")} ${chalk.dim(`(${behavior.totalSuccesses}/${behavior.totalEvents})`)}`)

  if (behavior.mostEdited) {
    console.log(`  Most edited:  ${chalk.white(behavior.mostEdited.path)} ${chalk.dim(`(${behavior.mostEdited.edits} edit${behavior.mostEdited.edits !== 1 ? "s" : ""})`)}`)
  }

  if (behavior.mostFailed) {
    console.log(`  Most failed:  ${chalk.red(behavior.mostFailed.path)} ${chalk.dim(`(${behavior.mostFailed.failures} failure${behavior.mostFailed.failures !== 1 ? "s" : ""})`)}`)
  }

  if (!behavior.mostEdited && !behavior.mostFailed) {
    console.log(chalk.dim("  No file-specific behavior recorded."))
  }
}

function renderRecommendations(recs: Recommendation[]): void {
  console.log(chalk.bold("  Recommendations"))
  console.log(chalk.gray("  " + "\u2500".repeat(55)))

  if (recs.length === 0) {
    console.log(chalk.green("  Everything looks good! No immediate actions needed."))
    return
  }

  for (const r of recs) {
    console.log(`  ${chalk.cyan("\u2192")} ${r.message}`)
  }
}

// ── Helpers ────────────────────────────────────────────

function extractDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const firstSlash = normalized.indexOf("/")
  if (firstSlash === -1) return ""
  // Show up to 2 levels for readability
  const secondSlash = normalized.indexOf("/", firstSlash + 1)
  const dir = secondSlash !== -1 ? normalized.slice(0, secondSlash) : normalized.slice(0, firstSlash)
  // Ensure trailing slash for visual clarity
  return dir + "/"
}

function classifyFromPath(p: string): FileClassification {
  const pathMatchers: [RegExp, FileClassification][] = [
    [/(^|\/)node_modules\//, "vendor"],
    [/\.agentlayer\//, "generated"],
    [/(^|\/)(dist|\.next|coverage|build|out|\.output)\//, "build"],
    [/\.min\.(js|css)$/, "generated"],
    [/(^|\/)(__tests__|test|tests|spec|specs)\//, "test"],
    [/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/, "test"],
    [/_test\.(go|rs)$/, "test"],
    [/\.md$/, "docs"],
    [/(^|\/)docs\//, "docs"],
    [/LICENSE|CHANGELOG|CONTRIBUTING/, "docs"],
    [/\.(css|scss|sass|less|styled|module\.css)$/, "asset"],
    [/\.(json|yaml|yml|toml|xml|csv|proto|graphql|gql)$/, "data"],
    [/\.(sql|prisma|drizzle)$/, "data"],
    [/\.config\.(ts|js|mjs|cjs)$/, "config"],
    [/^\.github\//, "config"],
    [/^Dockerfile/, "config"],
    [/^docker-compose/, "config"],
    [/^tsconfig/, "config"],
    [/^\.env/, "config"],
    [/\.(lock|lockfile)$/, "config"],
    [/^(package\.json|turbo\.json|nx\.json|lerna\.json|pnpm-workspace\.yaml)$/, "config"],
    [/\.(png|jpg|jpeg|gif|svg|ico|webp|avif|mp4|mp3|woff2?|ttf|eot)$/, "asset"],
  ]

  for (const [re, cls] of pathMatchers) {
    if (re.test(p)) return cls
  }

  const sourceExts = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".scala", ".clj", ".ex", ".exs", ".erl", ".hs", ".ml", ".vim", ".el",
    ".sh", ".bash", ".zsh", ".fish",
    ".html", ".htm", ".vue", ".svelte",
    ".zig", ".nim", ".lua", ".php",
  ])

  const ext = p.slice(p.lastIndexOf("."))
  if (sourceExts.has(ext)) return "source"
  return "data"
}
