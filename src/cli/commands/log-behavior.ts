import * as fs from "node:fs";
import * as path from "node:path";
import { insertBehaviorLog } from "../../behavior/log.js";
import { ContextStore } from "../../store/schema.js";

interface LogBehaviorOptions {
  file?: string;
  tool?: string;
  event?: string;
  success?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  sessionId?: string;
  agentId?: string;
  toolCallId?: string;
  sourceTool?: string;
  hookPhase?: string;
  durationMs?: string;
}

/**
 * Internal command: log agent behavior from hooks.
 * Called by post-tool-use and post-commit hooks.
 * Exits silently unless AGENTMIND_DEBUG is set.
 */
export async function logBehavior(options: LogBehaviorOptions): Promise<void> {
  const projectRoot = process.cwd();
  const storePath = path.join(projectRoot, ".agentmind", "context.db");

  if (!fs.existsSync(storePath)) {
    process.exit(0);
  }

  const store = new ContextStore(projectRoot);

  try {
    const success = options.success !== "false";
    const durationMs =
      options.durationMs != null && options.durationMs.length > 0
        ? Number(options.durationMs)
        : undefined;

    insertBehaviorLog(store, {
      projectRoot,
      filePath: options.file,
      tool: options.tool,
      event: options.event,
      success,
      agentType: options.event === "commit" ? "git" : "agent",
      traceId: options.traceId,
      spanId: options.spanId,
      parentSpanId: options.parentSpanId,
      sessionId: options.sessionId,
      agentId: options.agentId,
      toolCallId: options.toolCallId,
      sourceTool: options.sourceTool,
      hookPhase: options.hookPhase,
      durationMs:
        durationMs != null && Number.isFinite(durationMs)
          ? durationMs
          : undefined,
    });

    if (process.env.AGENTMIND_DEBUG) {
      console.error(
        `[agentmind] logged behavior: ${options.tool ?? options.event ?? "unknown"} on ${options.file ?? "(unknown)"} success=${success}`,
      );
    }
  } catch (error) {
    if (process.env.AGENTMIND_DEBUG) {
      console.error("[agentmind] log-behavior error:", error);
    }
  } finally {
    store.close();
  }

  process.exit(0);
}
