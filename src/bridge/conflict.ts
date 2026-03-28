import { AgentBridge } from "./state.js"

export interface ConflictWarning {
  filePath: string
  conflictingAgents: string[]
  severity: "warn" | "critical"
}

function severityForEditorCount(n: number): "warn" | "critical" {
  return n >= 2 ? "critical" : "warn"
}

export function detectConflicts(
  bridge: AgentBridge,
  filePath: string
): ConflictWarning[] {
  const editing = bridge.whoIsEditing(filePath)
  if (editing.length === 0) return []

  return [
    {
      filePath,
      conflictingAgents: editing.map((a) => a.agentId),
      severity: severityForEditorCount(editing.length),
    },
  ]
}

export function detectAllConflicts(bridge: AgentBridge): ConflictWarning[] {
  const agents = bridge.getActiveAgents()
  const fileEditors = new Map<string, string[]>()

  for (const agent of agents) {
    for (const f of agent.editingFiles) {
      const existing = fileEditors.get(f) ?? []
      existing.push(agent.agentId)
      fileEditors.set(f, existing)
    }
  }

  const warnings: ConflictWarning[] = []
  for (const [filePath, agentIds] of fileEditors) {
    if (agentIds.length > 1) {
      warnings.push({
        filePath,
        conflictingAgents: agentIds,
        severity: severityForEditorCount(agentIds.length),
      })
    }
  }
  return warnings
}
