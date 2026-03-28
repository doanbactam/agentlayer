export { startServer } from "./mcp/index.js"
export { ContextStore, importJSONL, exportJSONL, appendJSONL } from "./store/index.js"
export { scan, classify, detectPatterns, buildGraph } from "./scanner/index.js"
export type {
  Annotation,
  BehaviorEntry,
  ContextEntry,
  DependencyGraph,
  DependencyNode,
  FileClassification,
  FileInfo,
  HookConfig,
  HookEvent,
  NonInferablePattern,
  ProjectMeta,
  Rule,
  ScanResult,
  StoreHealth,
} from "./types/index.js"
