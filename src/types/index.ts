export interface FileInfo {
  path: string
  size: number
  modified: number
  hash: string
}

export type FileClassification =
  | "source"
  | "config"
  | "test"
  | "docs"
  | "generated"
  | "asset"
  | "data"
  | "build"
  | "vendor"

export interface NonInferablePattern {
  path: string
  pattern: string
  reason: string
  line?: number
  snippet?: string
}

export interface DependencyNode {
  path: string
  imports: string[]
  importedBy: string[]
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>
  roots: string[]
  orphans: string[]
}

export interface ContextEntry {
  id: string
  path: string
  classification: FileClassification
  rules: Rule[]
  annotations: Annotation[]
  behaviors: BehaviorEntry[]
  lastScanned: number
  hash: string
}

export interface Rule {
  id: string
  path?: string
  pattern: string
  description: string
  priority: number
}

export interface Annotation {
  id: string
  path: string
  line?: number
  text: string
  author: string
  created: number
}

export interface BehaviorEntry {
  id: string
  path: string
  pattern: string
  description: string
  frequency: number
  lastSeen: number
}

export interface ScanResult {
  files: FileInfo[]
  classifications: Map<string, FileClassification>
  patterns: NonInferablePattern[]
  graph: DependencyGraph
  duration: number
  timestamp: number
}

export interface ProjectMeta {
  name: string
  root: string
  language: string
  framework?: string
  filesTotal: number
  filesScanned: number
  lastScan?: number
}

export interface StoreHealth {
  dbSize: number
  entries: number
  staleEntries: number
  orphanedRules: number
  lastVacuum?: number
}

export interface HookConfig {
  agent: "claude" | "codex"
  events: HookEvent[]
  script: string
  enabled: boolean
}

export interface HookEvent {
  type: "pre_prompt" | "post_response" | "on_file_change"
  filter?: string
}
