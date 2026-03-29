import path from "node:path";
import { ContextStore } from "../store/schema.js";

export interface BehaviorLogInput {
  projectRoot: string;
  filePath?: string | null;
  tool?: string | null;
  event?: string | null;
  success: boolean;
  agentType: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  sessionId?: string;
  agentId?: string;
  toolCallId?: string;
  sourceTool?: string;
  hookPhase?: string;
  durationMs?: number;
}

function normalizeFilePath(
  projectRoot: string,
  filePath?: string | null,
): string | null {
  if (!filePath) return null;

  const resolved = path.resolve(projectRoot, filePath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.length === 0) return ".";
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, "/");
  }

  return filePath.replace(/\\/g, "/");
}

function cleanMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
}

export function insertBehaviorLog(
  store: ContextStore,
  input: BehaviorLogInput,
): void {
  const filePath = normalizeFilePath(input.projectRoot, input.filePath);
  const action = input.tool
    ? `tool:${input.tool}`
    : input.event
      ? input.event
      : "unknown";

  const metadata = cleanMetadata({
    pattern: input.tool ?? null,
    frequency: 1,
    tool: input.tool ?? null,
    event: input.event ?? null,
    traceId: input.traceId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId,
    sessionId: input.sessionId,
    agentId: input.agentId,
    toolCallId: input.toolCallId,
    sourceTool: input.sourceTool,
    hookPhase: input.hookPhase,
    durationMs: input.durationMs,
  });

  store
    .getDb()
    .run(
      "INSERT INTO behavior_log (agent_type, action, file_path, success, metadata) VALUES (?, ?, ?, ?, ?)",
      [
        input.agentType,
        action,
        filePath,
        input.success ? 1 : 0,
        JSON.stringify(metadata),
      ],
    );
}
