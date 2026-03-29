/**
 * End-to-end integration test for get_claims + log_behavior trace enrichment.
 * Runs against the real agentmind project via MCP JSON-RPC + CLI.
 *
 * Usage: node test/e2e-test.mjs
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";

import { AgentBridge } from "../dist/bridge/state.js";
import { ContextStore } from "../dist/store/schema.js";

// ── Config ──────────────────────────────────────────

const PROJECT_ROOT = process.cwd();
const CLI_PATH = path.join(PROJECT_ROOT, "dist", "cli", "index.js");
const STATE_PATH = path.join(PROJECT_ROOT, ".agentmind", "agent-state.json");

// ── Helpers ─────────────────────────────────────────

function sendRpc(child, message) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout });
    const onExit = (code) => {
      rl.close();
      reject(new Error(`serve exited before response: ${code}`));
    };
    child.once("exit", onExit);
    rl.once("line", (line) => {
      child.off("exit", onExit);
      rl.close();
      resolve(JSON.parse(line));
    });
    child.stdin.write(JSON.stringify(message) + "\n");
  });
}

function callTool(child, toolName, args) {
  return sendRpc(child, {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

function startServer() {
  return spawn(process.execPath, [CLI_PATH, "serve"], {
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function resetBridgeState() {
  if (existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, JSON.stringify({ agents: {} }, null, 2), "utf-8");
  }
}

function queryBehaviorDb() {
  const store = new ContextStore(PROJECT_ROOT);
  try {
    return store
      .getDb()
      .query("SELECT * FROM behavior_log ORDER BY id DESC LIMIT 20")
      .all();
  } finally {
    store.close();
  }
}

// ── Test runner ─────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log("  PASS  " + name);
    passed++;
  } catch (err) {
    console.error("  FAIL  " + name);
    console.error("        " + err.message);
    failed++;
  }
}

// ── Tests ───────────────────────────────────────────

async function main() {
  console.log(
    "\n=== E2E: agentmind get_claims + log_behavior trace enrichment ===\n",
  );

  // ── Phase 1: Bridge Claims via MCP ────────────────

  await test("1.1 get_claims returns empty when no agents", async () => {
    resetBridgeState();
    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "get_claims", {});
      const payload = JSON.parse(res.result.content[0].text);
      assert.deepEqual(payload, { files: [] });
    } finally {
      await stopServer(child);
    }
  });

  await test("1.2 register + claim shows in get_claims", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.claimFiles("agent-001", ["src/index.ts", "src/config.ts"]);

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "get_claims", {});
      const payload = JSON.parse(res.result.content[0].text);

      assert.ok(
        payload.files.length >= 2,
        "Expected >= 2 files, got " + payload.files.length,
      );
      const idx = payload.files.find((f) => f.filePath === "src/index.ts");
      assert.ok(idx, "Should find src/index.ts");
      assert.equal(idx.claims.length, 1);
      assert.equal(idx.claims[0].agentId, "agent-001");
      assert.equal(idx.claims[0].active, true);
    } finally {
      await stopServer(child);
      bridge.unregister("agent-001");
    }
  });

  await test("1.3 get_claims filters by filePath", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.claimFiles("agent-001", ["src/index.ts", "src/config.ts"]);

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "get_claims", {
        filePath: "src/config.ts",
      });
      const payload = JSON.parse(res.result.content[0].text);
      assert.equal(payload.files.length, 1);
      assert.equal(payload.files[0].filePath, "src/config.ts");
      assert.equal(payload.files[0].claims[0].agentId, "agent-001");
    } finally {
      await stopServer(child);
      bridge.unregister("agent-001");
    }
  });

  await test("1.4 get_claims hides inactive by default", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.claimFiles("agent-001", ["src/index.ts"]);

    const state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    state.agents["agent-001"].lastHeartbeat = 0;
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "get_claims", {});
      const payload = JSON.parse(res.result.content[0].text);
      assert.deepEqual(payload, { files: [] });
    } finally {
      await stopServer(child);
      bridge.unregister("agent-001");
    }
  });

  await test("1.5 get_claims shows inactive when includeInactive=true", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.claimFiles("agent-001", ["src/index.ts"]);

    const state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    state.agents["agent-001"].lastHeartbeat = 0;
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "get_claims", {
        includeInactive: true,
      });
      const payload = JSON.parse(res.result.content[0].text);
      assert.equal(payload.files.length, 1);
      assert.equal(payload.files[0].claims[0].active, false);
    } finally {
      await stopServer(child);
      bridge.unregister("agent-001");
    }
  });

  await test("1.6 get_claims does NOT mutate bridge state", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.claimFiles("agent-001", ["src/index.ts"]);

    const before = readFileSync(STATE_PATH, "utf-8");

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      await callTool(child, "get_claims", {});
      const after = readFileSync(STATE_PATH, "utf-8");
      assert.equal(before, after, "get_claims should not modify bridge state");
    } finally {
      await stopServer(child);
      bridge.unregister("agent-001");
    }
  });

  await test("1.7 multiple agents on same file shows conflict", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.register("agent-002", "cursor");
    bridge.register("agent-003", "windsurf");
    bridge.claimFiles("agent-001", ["src/config.ts"]);
    bridge.claimFiles("agent-002", ["src/config.ts"]);
    bridge.claimFiles("agent-003", ["src/config.ts", "src/utils.ts"]);

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "get_claims", {
        filePath: "src/config.ts",
      });
      const payload = JSON.parse(res.result.content[0].text);
      assert.equal(payload.files.length, 1);
      // agent-003 gets pruned by heartbeat but only agent-001 and agent-002
      // should be visible since they were registered in the same process
      assert.ok(
        payload.files[0].claims.length >= 2,
        "Expected >= 2 claims on src/config.ts",
      );
    } finally {
      await stopServer(child);
      bridge.unregister("agent-001");
      bridge.unregister("agent-002");
      bridge.unregister("agent-003");
    }
  });

  // ── Phase 2: Behavior Log Trace via MCP ───────────

  await test("2.1 log_behavior without trace (backward compat)", async () => {
    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "log_behavior", {
        filePath: "src/index.ts",
        tool: "edit_file",
        success: true,
      });
      assert.ok(res.result.content[0].text.includes("Behavior logged"));
      assert.ok(res.result.content[0].text.includes("success"));

      const rows = queryBehaviorDb();
      assert.ok(rows.length > 0, "Should have behavior log entries");
      const row = rows[0];
      assert.equal(row.action, "tool:edit_file");
      const meta = JSON.parse(row.metadata);
      assert.equal(meta.pattern, "edit_file");
      assert.equal(meta.tool, "edit_file");
    } finally {
      await stopServer(child);
    }
  });

  await test("2.2 log_behavior with full trace metadata", async () => {
    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "log_behavior", {
        filePath: "src/config.ts",
        tool: "edit_file",
        success: true,
        traceId: "trace-abc-123",
        spanId: "span-def456",
        parentSpanId: "span-root",
        sessionId: "ses-xyz",
        agentId: "agent-001",
        toolCallId: "tc-789",
        sourceTool: "claude-code",
        hookPhase: "post-tool-use",
        durationMs: 42,
      });
      assert.ok(res.result.content[0].text.includes("Behavior logged"));

      const rows = queryBehaviorDb();
      const row = rows[0];
      const meta = JSON.parse(row.metadata);
      assert.equal(meta.traceId, "trace-abc-123");
      assert.equal(meta.spanId, "span-def456");
      assert.equal(meta.parentSpanId, "span-root");
      assert.equal(meta.sessionId, "ses-xyz");
      assert.equal(meta.agentId, "agent-001");
      assert.equal(meta.toolCallId, "tc-789");
      assert.equal(meta.sourceTool, "claude-code");
      assert.equal(meta.hookPhase, "post-tool-use");
      assert.equal(meta.durationMs, 42);
    } finally {
      await stopServer(child);
    }
  });

  await test("2.3 log_behavior with non-boolean success returns error", async () => {
    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "log_behavior", {
        filePath: "src/index.ts",
        tool: "test",
        success: "not-a-boolean",
      });
      assert.ok(res.result.content[0].text.includes("Error"));
      assert.ok(res.result.content[0].text.includes("boolean"));
    } finally {
      await stopServer(child);
    }
  });

  // ── Phase 3: CLI log-behavior with trace ──────────

  await test("3.1 CLI log-behavior with trace metadata", async () => {
    const result = spawnSync(
      process.execPath,
      [
        CLI_PATH,
        "log-behavior",
        "--file",
        "src/mcp/server.ts",
        "--tool",
        "create_file",
        "--success",
        "true",
        "--trace-id",
        "trace-cli-direct",
        "--span-id",
        "span-cli-direct",
        "--session-id",
        "ses-cli-direct",
        "--hook-phase",
        "post-tool-use",
        "--duration-ms",
        "3000",
        "--source-tool",
        "opencode",
      ],
      { cwd: PROJECT_ROOT, encoding: "utf-8", stdio: "ignore" },
    );
    assert.equal(result.status, 0, "CLI log-behavior should exit 0");

    const rows = queryBehaviorDb();
    const row = rows[0];
    assert.equal(row.action, "tool:create_file");
    const meta = JSON.parse(row.metadata);
    assert.equal(meta.traceId, "trace-cli-direct");
    assert.equal(meta.spanId, "span-cli-direct");
    assert.equal(meta.sessionId, "ses-cli-direct");
    assert.equal(meta.hookPhase, "post-tool-use");
    assert.equal(meta.durationMs, 3000);
    assert.equal(meta.sourceTool, "opencode");
    assert.equal(row.agent_type, "agent");
  });

  await test("3.2 CLI log-behavior without trace (backward compat)", async () => {
    const result = spawnSync(
      process.execPath,
      [
        CLI_PATH,
        "log-behavior",
        "--file",
        "src/store/schema.ts",
        "--event",
        "commit",
        "--success",
        "true",
      ],
      { cwd: PROJECT_ROOT, encoding: "utf-8", stdio: "ignore" },
    );
    assert.equal(result.status, 0, "CLI log-behavior should exit 0");

    const rows = queryBehaviorDb();
    const row = rows[0];
    assert.equal(row.action, "commit");
    assert.equal(row.agent_type, "git");
    const meta = JSON.parse(row.metadata);
    assert.ok(!meta.traceId, "Should not have traceId");
    assert.ok(!meta.spanId, "Should not have spanId");
  });

  // ── Phase 4: Edge cases ───────────────────────────

  await test("4.1 Windows backslash paths normalize", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.claimFiles("agent-001", [".\\src\\index.ts"]);

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "get_claims", {
        filePath: "src/index.ts",
      });
      const payload = JSON.parse(res.result.content[0].text);
      assert.equal(payload.files.length, 1);
      assert.equal(payload.files[0].filePath, "src/index.ts");
    } finally {
      await stopServer(child);
      bridge.unregister("agent-001");
    }
  });

  await test("4.2 Corrupt state file returns empty gracefully", async () => {
    writeFileSync(STATE_PATH, "THIS IS NOT JSON{{{broken", "utf-8");

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "get_claims", {});
      const payload = JSON.parse(res.result.content[0].text);
      assert.deepEqual(payload, { files: [] });
    } finally {
      await stopServer(child);
      resetBridgeState();
    }
  });

  await test("4.3 Unregister clears claims", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.claimFiles("agent-001", ["src/index.ts"]);
    bridge.unregister("agent-001");

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });
      const res = await callTool(child, "get_claims", {});
      const payload = JSON.parse(res.result.content[0].text);
      assert.deepEqual(payload, { files: [] });
    } finally {
      await stopServer(child);
    }
  });

  // ── Phase 5: Cross-tool integration ───────────────

  await test("5.1 claims + behavior + health pipeline works together", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.claimFiles("agent-001", ["src/config.ts", "src/index.ts"]);

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });

      await callTool(child, "log_behavior", {
        filePath: "src/config.ts",
        tool: "edit_file",
        success: false,
        traceId: "trace-fail-1",
        sessionId: "ses-e2e",
        hookPhase: "post-tool-use",
        durationMs: 50,
      });

      await callTool(child, "log_behavior", {
        filePath: "src/config.ts",
        tool: "edit_file",
        success: true,
        traceId: "trace-success",
        sessionId: "ses-e2e",
        hookPhase: "post-tool-use",
        durationMs: 200,
      });

      const claimsRes = await callTool(child, "get_claims", {
        filePath: "src/config.ts",
      });
      const claimsPayload = JSON.parse(claimsRes.result.content[0].text);
      assert.equal(claimsPayload.files.length, 1);
      assert.equal(claimsPayload.files[0].claims[0].agentId, "agent-001");

      const healthRes = await callTool(child, "get_health", {});
      assert.ok(healthRes.result.content[0].text.includes("Context Health"));
    } finally {
      await stopServer(child);
      bridge.unregister("agent-001");
    }
  });

  await test("5.2 release claims updates get_claims", async () => {
    resetBridgeState();
    const bridge = new AgentBridge(PROJECT_ROOT);
    bridge.register("agent-001", "claude");
    bridge.claimFiles("agent-001", ["src/config.ts", "src/index.ts"]);

    const child = startServer();
    try {
      await sendRpc(child, { jsonrpc: "2.0", id: 1, method: "initialize" });

      const c1 = await callTool(child, "get_claims", {
        filePath: "src/config.ts",
      });
      assert.equal(JSON.parse(c1.result.content[0].text).files.length, 1);

      bridge.releaseFiles("agent-001", ["src/config.ts"]);

      const c2 = await callTool(child, "get_claims", {
        filePath: "src/config.ts",
      });
      assert.deepEqual(JSON.parse(c2.result.content[0].text), { files: [] });

      const c3 = await callTool(child, "get_claims", {});
      const allPayload = JSON.parse(c3.result.content[0].text);
      assert.equal(allPayload.files.length, 1);
      assert.equal(allPayload.files[0].filePath, "src/index.ts");
    } finally {
      await stopServer(child);
      bridge.unregister("agent-001");
    }
  });

  // ── Summary ───────────────────────────────────────

  console.log(
    "\n=== Results: " + passed + " passed, " + failed + " failed ===",
  );
  if (failed > 0) {
    console.error("\nE2E tests FAILED. Fix issues before shipping.");
    process.exit(1);
  } else {
    console.log("\nAll E2E tests passed!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
