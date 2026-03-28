import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { AgentBridge } from "../dist/bridge/state.js"

function createTempProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmind-bridge-"))
  mkdirSync(path.join(dir, ".agentmind"), { recursive: true })
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

function readState(bridge) {
  const statePath = bridge.getStatePath()
  if (!existsSync(statePath)) {
    return { agents: {} }
  }
  return JSON.parse(readFileSync(statePath, "utf-8"))
}

test("register agent adds it to state", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)
    bridge.register("agent-001", "claude")

    const state = readState(bridge)
    assert.ok(state.agents["agent-001"], "Agent should be in state")
    assert.equal(state.agents["agent-001"].agentId, "agent-001")
    assert.equal(state.agents["agent-001"].tool, "claude")
    assert.ok(state.agents["agent-001"].lastHeartbeat, "Should have heartbeat timestamp")
  } finally {
    cleanup(dir)
  }
})

test("claimFiles locks files for an agent", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)
    bridge.register("agent-001", "claude")
    bridge.claimFiles("agent-001", ["src/index.ts", "src/utils.ts"])

    const state = readState(bridge)
    assert.deepEqual(
      state.agents["agent-001"].editingFiles.sort(),
      ["src/index.ts", "src/utils.ts"].sort(),
    )
  } finally {
    cleanup(dir)
  }
})

test("releaseFiles unlocks files for an agent", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)
    bridge.register("agent-001", "claude")
    bridge.claimFiles("agent-001", ["src/index.ts", "src/utils.ts", "src/config.ts"])
    bridge.releaseFiles("agent-001", ["src/index.ts", "src/config.ts"])

    const state = readState(bridge)
    assert.deepEqual(
      state.agents["agent-001"].editingFiles,
      ["src/utils.ts"],
    )
  } finally {
    cleanup(dir)
  }
})

test("whoIsEditing detects conflict when two agents claim same file", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)

    // Register two agents
    bridge.register("agent-001", "claude")
    bridge.register("agent-002", "cursor")

    // Both claim the same file
    bridge.claimFiles("agent-001", ["src/index.ts"])
    bridge.claimFiles("agent-002", ["src/index.ts"])

    // Check who is editing the file
    const editors = bridge.whoIsEditing("src/index.ts")
    assert.equal(editors.length, 2, "Two agents should be editing the same file")

    const agentIds = editors.map(a => a.agentId).sort()
    assert.deepEqual(agentIds, ["agent-001", "agent-002"])
  } finally {
    cleanup(dir)
  }
})

test("claimFiles is additive (does not replace existing claims)", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)
    bridge.register("agent-001", "claude")
    bridge.claimFiles("agent-001", ["src/a.ts"])
    bridge.claimFiles("agent-001", ["src/b.ts"])

    const state = readState(bridge)
    assert.deepEqual(
      state.agents["agent-001"].editingFiles.sort(),
      ["src/a.ts", "src/b.ts"].sort(),
    )
  } finally {
    cleanup(dir)
  }
})

test("releaseFiles on unregistered agent does not throw", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)
    // Should not throw
    bridge.releaseFiles("non-existent-agent", ["src/index.ts"])
  } finally {
    cleanup(dir)
  }
})

test("claimFiles on unregistered agent does not throw", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)
    // Should not throw
    bridge.claimFiles("non-existent-agent", ["src/index.ts"])

    const state = readState(bridge)
    assert.deepEqual(state.agents, {}, "No agents should be registered")
  } finally {
    cleanup(dir)
  }
})

test("unregister removes agent from state", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)
    bridge.register("agent-001", "claude")
    bridge.unregister("agent-001")

    const state = readState(bridge)
    assert.deepEqual(state.agents, {}, "Agent should be removed from state")
  } finally {
    cleanup(dir)
  }
})

test("heartbeat updates lastHeartbeat timestamp", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)
    bridge.register("agent-001", "claude")

    const before = readState(bridge).agents["agent-001"].lastHeartbeat

    // Wait a bit and send heartbeat
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    bridge.heartbeat("agent-001")

    const after = readState(bridge).agents["agent-001"].lastHeartbeat
    assert.ok(after > before, "Heartbeat should update timestamp")
  } finally {
    cleanup(dir)
  }
})

test("getActiveAgents returns registered agents", () => {
  const dir = createTempProject()
  try {
    const bridge = new AgentBridge(dir)
    bridge.register("agent-001", "claude")
    bridge.register("agent-002", "cursor")

    const agents = bridge.getActiveAgents()
    assert.equal(agents.length, 2)

    const ids = agents.map(a => a.agentId).sort()
    assert.deepEqual(ids, ["agent-001", "agent-002"])
  } finally {
    cleanup(dir)
  }
})
