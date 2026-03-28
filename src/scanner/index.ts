import { classify } from "./classify.js"
import { detectPatterns } from "./patterns.js"
import { buildGraph } from "./graph.js"
import type { ScanResult } from "../types/index.js"

export { classify } from "./classify.js"
export { detectPatterns } from "./patterns.js"
export { buildGraph } from "./graph.js"

export async function scan(root: string): Promise<ScanResult> {
  const start = performance.now()

  const { files, classifications } = await classify(root)
  const [patterns, graph] = await Promise.all([
    detectPatterns(root, files),
    buildGraph(root, files),
  ])

  return {
    files,
    classifications,
    patterns,
    graph,
    duration: performance.now() - start,
    timestamp: Date.now(),
  }
}
