import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs"
import { dirname, join } from "node:path"

export interface AgentActivity {
  agentId: string
  tool: string
  editingFiles: string[]
  lastHeartbeat: number
  pid: number
}

interface BridgeState {
  agents: Record<string, AgentActivity>
}

const HEARTBEAT_TIMEOUT_MS = 30_000

const EMPTY: BridgeState = { agents: {} }

const MAX_WRITE_RETRIES = 3
const RETRY_DELAY_MS = 50

export class AgentBridge {
  private statePath: string
  private tmpPath: string

  constructor(projectRoot: string) {
    this.statePath = join(projectRoot, ".agentmind", "agent-state.json")
    this.tmpPath = join(projectRoot, ".agentmind", "agent-state.tmp")
  }

  register(agentId: string, tool: string): void {
    const state = this.read()
    state.agents[agentId] = {
      agentId,
      tool,
      editingFiles: state.agents[agentId]?.editingFiles ?? [],
      lastHeartbeat: Date.now(),
      pid: process.pid,
    }
    this.write(state)
  }

  claimFiles(agentId: string, files: string[]): void {
    const state = this.read()
    const agent = state.agents[agentId]
    if (!agent) return
    const claimed = new Set(agent.editingFiles)
    for (const f of files) claimed.add(f)
    agent.editingFiles = [...claimed]
    agent.lastHeartbeat = Date.now()
    this.write(state)
  }

  releaseFiles(agentId: string, files: string[]): void {
    const state = this.read()
    const agent = state.agents[agentId]
    if (!agent) return
    const released = new Set(files)
    agent.editingFiles = agent.editingFiles.filter((f) => !released.has(f))
    agent.lastHeartbeat = Date.now()
    this.write(state)
  }

  whoIsEditing(filePath: string): AgentActivity[] {
    return this.getActiveAgents().filter((a) =>
      a.editingFiles.includes(filePath)
    )
  }

  getActiveAgents(): AgentActivity[] {
    this.prune()
    return Object.values(this.read().agents)
  }

  prune(): void {
    const state = this.read()
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS
    let changed = false
    for (const id of Object.keys(state.agents)) {
      if (state.agents[id].lastHeartbeat < cutoff) {
        delete state.agents[id]
        changed = true
      }
    }
    if (changed) this.write(state)
  }

  heartbeat(agentId: string): void {
    const state = this.read()
    const agent = state.agents[agentId]
    if (!agent) return
    agent.lastHeartbeat = Date.now()
    this.write(state)
  }

  unregister(agentId: string): void {
    const state = this.read()
    delete state.agents[agentId]
    this.write(state)
  }

  getStatePath(): string {
    return this.statePath
  }

  private read(): BridgeState {
    if (!existsSync(this.statePath)) return EMPTY

    const raw = readFileSync(this.statePath, "utf-8")
    try {
      return JSON.parse(raw) as BridgeState
    } catch {
      console.warn(
        `[agentmind] corrupt state file (${this.statePath}), treating as empty. Fix or delete the file.`
      )
      return EMPTY
    }
  }

  /** Read state without fallback — throws on missing or corrupt file. */
  readUnsafe(): BridgeState {
    const raw = readFileSync(this.statePath, "utf-8")
    return JSON.parse(raw) as BridgeState
  }

  private write(state: BridgeState): void {
    const dir = dirname(this.statePath)
    mkdirSync(dir, { recursive: true })
    const json = JSON.stringify(state, null, 2)

    for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
      try {
        writeFileSync(this.tmpPath, json, "utf-8")
        renameSync(this.tmpPath, this.statePath)
        return
      } catch {
        if (attempt === MAX_WRITE_RETRIES) {
          // rename can fail across drives; fall back to direct write
          try {
            writeFileSync(this.statePath, json, "utf-8")
          } finally {
            try { unlinkSync(this.tmpPath) } catch { /* best-effort cleanup */ }
          }
          return
        }
        // Brief pause before retry
        const end = Date.now() + RETRY_DELAY_MS
        while (Date.now() < end) {}
      }
    }
  }
}
