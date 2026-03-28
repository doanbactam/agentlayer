import {
  installClaudeHooks,
  uninstallClaudeHooks,
  isClaudeHooksInstalled,
  installCodexHooks,
  uninstallCodexHooks,
  isCodexHooksInstalled,
} from "../../hooks/index.js";

export async function hooks(agent: string): Promise<void> {
  const projectRoot = process.cwd();
  const normalizedAgent = agent.toLowerCase();

  if (normalizedAgent === "claude") {
    if (isClaudeHooksInstalled(projectRoot)) {
      console.log("Claude Code hooks already installed. Reinstalling...");
      uninstallClaudeHooks(projectRoot);
    }

    installClaudeHooks(projectRoot);
    console.log("✓ Claude Code hooks installed");
    console.log("  - Pre-tool-use: injects context before file operations");
    console.log("  - Post-tool-use: logs behavior after edits");
    console.log("  - Post-commit: records file changes");
    console.log("\nHooks are configured in .claude/settings.local.json");
    return;
  }

  if (normalizedAgent === "codex") {
    if (isCodexHooksInstalled(projectRoot)) {
      console.log("Codex CLI hooks already installed. Reinstalling...");
      uninstallCodexHooks(projectRoot);
    }

    installCodexHooks(projectRoot);
    console.log("✓ Codex CLI hooks installed");
    console.log("  - Pre-tool-use: injects context before file operations");
    console.log("  - Post-tool-use: logs behavior after edits");
    console.log("\nHooks are configured in .codex/config.json");
    return;
  }

  console.error(`Unknown agent: ${agent}`);
  console.error("Supported agents: claude, codex");
  process.exit(1);
}

export async function unhook(agent: string): Promise<void> {
  const projectRoot = process.cwd();
  const normalizedAgent = agent.toLowerCase();

  if (normalizedAgent === "claude") {
    if (!isClaudeHooksInstalled(projectRoot)) {
      console.log("Claude Code hooks are not installed");
      return;
    }

    uninstallClaudeHooks(projectRoot);
    console.log("✓ Claude Code hooks removed");
    return;
  }

  if (normalizedAgent === "codex") {
    if (!isCodexHooksInstalled(projectRoot)) {
      console.log("Codex CLI hooks are not installed");
      return;
    }

    uninstallCodexHooks(projectRoot);
    console.log("✓ Codex CLI hooks removed");
    return;
  }

  console.error(`Unknown agent: ${agent}`);
  console.error("Supported agents: claude, codex");
  process.exit(1);
}
