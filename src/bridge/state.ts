import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface AgentActivity {
  agentId: string;
  tool: string;
  editingFiles: string[];
  lastHeartbeat: number;
  pid: number;
}

export interface AgentClaim {
  agentId: string;
  tool: string;
  lastHeartbeat: number;
  active: boolean;
  pid: number;
}

export interface FileClaims {
  filePath: string;
  claims: AgentClaim[];
}

interface BridgeState {
  agents: Record<string, AgentActivity>;
}

const HEARTBEAT_TIMEOUT_MS = 300_000;

const MAX_WRITE_RETRIES = 3;
const RETRY_DELAY_MS = 50;

function emptyState(): BridgeState {
  return { agents: {} };
}

function normalizeClaimPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export class AgentBridge {
  private statePath: string;
  private tmpPath: string;

  constructor(projectRoot: string) {
    this.statePath = join(projectRoot, ".agentmind", "agent-state.json");
    this.tmpPath = join(projectRoot, ".agentmind", "agent-state.tmp");
  }

  register(agentId: string, tool: string): void {
    const state = this.read();
    state.agents[agentId] = {
      agentId,
      tool,
      editingFiles:
        state.agents[agentId]?.editingFiles.map(normalizeClaimPath) ?? [],
      lastHeartbeat: Date.now(),
      pid: process.pid,
    };
    this.write(state);
  }

  claimFiles(agentId: string, files: string[]): void {
    const state = this.read();
    const agent = state.agents[agentId];
    if (!agent) return;
    const claimed = new Set(agent.editingFiles.map(normalizeClaimPath));
    for (const f of files) claimed.add(normalizeClaimPath(f));
    agent.editingFiles = [...claimed];
    agent.lastHeartbeat = Date.now();
    this.write(state);
  }

  releaseFiles(agentId: string, files: string[]): void {
    const state = this.read();
    const agent = state.agents[agentId];
    if (!agent) return;
    const released = new Set(files.map(normalizeClaimPath));
    agent.editingFiles = agent.editingFiles.filter(
      (f) => !released.has(normalizeClaimPath(f)),
    );
    agent.lastHeartbeat = Date.now();
    this.write(state);
  }

  whoIsEditing(filePath: string): AgentActivity[] {
    const normalized = normalizeClaimPath(filePath);
    return this.getActiveAgents().filter((a) =>
      a.editingFiles.map(normalizeClaimPath).includes(normalized),
    );
  }

  getActiveAgents(): AgentActivity[] {
    this.prune();
    return Object.values(this.read().agents);
  }

  prune(): void {
    const state = this.read();
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    let changed = false;
    for (const id of Object.keys(state.agents)) {
      if (state.agents[id].lastHeartbeat < cutoff) {
        delete state.agents[id];
        changed = true;
      }
    }
    if (changed) this.write(state);
  }

  heartbeat(agentId: string): void {
    const state = this.read();
    const agent = state.agents[agentId];
    if (!agent) return;
    agent.lastHeartbeat = Date.now();
    this.write(state);
  }

  unregister(agentId: string): void {
    const state = this.read();
    delete state.agents[agentId];
    this.write(state);
  }

  getStatePath(): string {
    return this.statePath;
  }

  getClaimsSnapshot(opts?: {
    filePath?: string;
    includeInactive?: boolean;
  }): FileClaims[] {
    const state = this.read();
    const includeInactive = opts?.includeInactive ?? false;
    const filePath = opts?.filePath
      ? normalizeClaimPath(opts.filePath)
      : undefined;
    const now = Date.now();
    const files = new Map<string, AgentClaim[]>();

    for (const agent of Object.values(state.agents)) {
      const active = this.isActive(agent, now);
      if (!includeInactive && !active) continue;

      for (const rawFilePath of agent.editingFiles) {
        const normalizedFilePath = normalizeClaimPath(rawFilePath);
        if (filePath && normalizedFilePath !== filePath) continue;

        const claims = files.get(normalizedFilePath) ?? [];
        claims.push({
          agentId: agent.agentId,
          tool: agent.tool,
          lastHeartbeat: agent.lastHeartbeat,
          active,
          pid: agent.pid,
        });
        files.set(normalizedFilePath, claims);
      }
    }

    return [...files.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([claimedFilePath, claims]) => ({
        filePath: claimedFilePath,
        claims: claims.sort((a, b) => a.agentId.localeCompare(b.agentId)),
      }));
  }

  private isActive(agent: AgentActivity, now: number = Date.now()): boolean {
    return agent.lastHeartbeat >= now - HEARTBEAT_TIMEOUT_MS;
  }

  private read(): BridgeState {
    if (!existsSync(this.statePath)) return emptyState();

    const raw = readFileSync(this.statePath, "utf-8");
    try {
      return JSON.parse(raw) as BridgeState;
    } catch {
      console.warn(
        `[agentmind] corrupt state file (${this.statePath}), treating as empty. Fix or delete the file.`,
      );
      return emptyState();
    }
  }

  /** Read state without fallback — throws on missing or corrupt file. */
  readUnsafe(): BridgeState {
    const raw = readFileSync(this.statePath, "utf-8");
    return JSON.parse(raw) as BridgeState;
  }

  private write(state: BridgeState): void {
    const dir = dirname(this.statePath);
    mkdirSync(dir, { recursive: true });
    const json = JSON.stringify(state, null, 2);

    for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
      try {
        writeFileSync(this.tmpPath, json, "utf-8");
        renameSync(this.tmpPath, this.statePath);
        return;
      } catch {
        if (attempt === MAX_WRITE_RETRIES) {
          // rename can fail across drives; fall back to direct write
          try {
            writeFileSync(this.statePath, json, "utf-8");
          } finally {
            try {
              unlinkSync(this.tmpPath);
            } catch {
              /* best-effort cleanup */
            }
          }
          return;
        }
        // Brief pause before retry
        const end = Date.now() + RETRY_DELAY_MS;
        while (Date.now() < end) {
          /* busy-wait */
        }
      }
    }
  }
}
