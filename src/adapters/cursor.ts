import { createSyncAdapter } from "./types.js";
import { renderRulesSections } from "./rules-render.js";

export const cursor = createSyncAdapter("cursor", ".cursorrules", (ctx) => {
  const header = [
    "# agentmind context (auto-generated — do not edit manually)",
    "# Run `agentmind sync --tool cursor` to update",
    "",
  ].join("\n");

  return header + renderRulesSections(ctx);
});
