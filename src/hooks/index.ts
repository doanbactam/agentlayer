export {
  generatePostToolUseHook,
  generatePostCommitHook,
  generateAllHooks,
} from "./template.js";

export {
  installClaudeHooks,
  uninstallClaudeHooks,
  getClaudeHookConfig,
  isClaudeHooksInstalled,
} from "./claude.js";

export {
  installCodexHooks,
  uninstallCodexHooks,
  getCodexHookConfig,
  isCodexHooksInstalled,
} from "./codex.js";

export type { HookConfig, HookEvent } from "../types/index.js";
