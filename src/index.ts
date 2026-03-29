export { startServer } from "./mcp/index.js";
export {
  ContextStore,
  importJSONL,
  exportJSONL,
  appendJSONL,
} from "./store/index.js";
export { AgentBridge } from "./bridge/state.js";
export type { AgentActivity } from "./bridge/state.js";
export { detectConflicts, detectAllConflicts } from "./bridge/conflict.js";
export type { ConflictWarning } from "./bridge/conflict.js";
export { analyzeBehaviors } from "./learn/analyzer.js";
export type { LearnedRule } from "./learn/analyzer.js";
export { generateRules, applyRules } from "./learn/generator.js";
export type { GeneratedRule } from "./learn/generator.js";
export {
  generatePostToolUseHook,
  generatePostCommitHook,
  generateAllHooks,
  installClaudeHooks,
  uninstallClaudeHooks,
  isClaudeHooksInstalled,
  installCodexHooks,
  uninstallCodexHooks,
  isCodexHooksInstalled,
} from "./hooks/index.js";
export type {
  Annotation,
  BehaviorEntry,
  ContextEntry,
  HookConfig,
  HookEvent,
  ProjectMeta,
  Rule,
  StoreHealth,
} from "./types/index.js";
