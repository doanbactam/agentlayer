import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { ContextStore } from "../dist/store/schema.js";

const projectRoot = process.cwd();
const cliPath = path.join(projectRoot, "dist", "cli", "index.js");

function createFixtureProject(prefix) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });
  writeFileSync(path.join(fixtureRoot, ".gitignore"), "node_modules\n");
  writeFileSync(
    path.join(fixtureRoot, "package.json"),
    JSON.stringify(
      {
        name: "fixture-app",
        version: "1.0.0",
        type: "module",
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(fixtureRoot, "src", "index.ts"),
    [
      "export function main() {",
      "  // TODO: replace mock logic",
      "  return process.platform",
      "}",
      "",
    ].join("\n"),
  );
  return fixtureRoot;
}

function runCliInit(cwd) {
  const args = [cliPath, "init"];
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf-8" });
  return result;
}

// Need spawnSync for init
import { spawnSync } from "node:child_process";

function requestJsonRpc(child, message) {
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
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

function stopChild(child) {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

async function callTool(child, toolName, args) {
  const response = await requestJsonRpc(child, {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  });
  return response;
}

function getLatestBehaviorRow(cwd) {
  const store = new ContextStore(cwd);
  try {
    return store
      .getDb()
      .query("SELECT * FROM behavior_log ORDER BY id DESC LIMIT 1")
      .get();
  } finally {
    store.close();
  }
}

test("get_claims returns empty files when no bridge state exists", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-claims-empty-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      const response = await callTool(child, "get_claims", {});
      const payload = JSON.parse(response.result.content[0].text);

      assert.deepEqual(payload, { files: [] });
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("get_claims returns claims for a specific file", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-claims-file-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    writeFileSync(
      path.join(fixtureRoot, ".agentmind", "agent-state.json"),
      JSON.stringify(
        {
          agents: {
            "agent-001": {
              agentId: "agent-001",
              tool: "claude",
              editingFiles: ["src/index.ts", "src/other.ts"],
              lastHeartbeat: Date.now(),
              pid: 1234,
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      const response = await callTool(child, "get_claims", {
        filePath: "src/index.ts",
      });
      const payload = JSON.parse(response.result.content[0].text);

      assert.equal(payload.files.length, 1);
      assert.equal(payload.files[0].filePath, "src/index.ts");
      assert.equal(payload.files[0].claims.length, 1);
      assert.equal(payload.files[0].claims[0].agentId, "agent-001");
      assert.equal(payload.files[0].claims[0].active, true);
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("get_claims includes inactive claims when requested", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-claims-inactive-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    writeFileSync(
      path.join(fixtureRoot, ".agentmind", "agent-state.json"),
      JSON.stringify(
        {
          agents: {
            "agent-001": {
              agentId: "agent-001",
              tool: "claude",
              editingFiles: ["src/index.ts"],
              lastHeartbeat: 0,
              pid: 1234,
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      let response = await callTool(child, "get_claims", {
        filePath: "src/index.ts",
      });
      let payload = JSON.parse(response.result.content[0].text);
      assert.deepEqual(payload, { files: [] });

      response = await callTool(child, "get_claims", {
        filePath: "src/index.ts",
        includeInactive: true,
      });
      payload = JSON.parse(response.result.content[0].text);
      assert.equal(payload.files.length, 1);
      assert.equal(payload.files[0].claims[0].active, false);
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("get_context with filePath returns context", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-getctx-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      const response = await callTool(child, "get_context", {
        filePath: "src/index.ts",
      });

      assert.ok(response.result, "Should have result");
      assert.ok(response.result.content, "Should have content");
      assert.ok(
        Array.isArray(response.result.content),
        "Content should be array",
      );
      assert.equal(response.result.content[0].type, "text");
      // Response should be a string (even if "No context entries found")
      assert.ok(typeof response.result.content[0].text === "string");
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("annotate_file with valid args saves annotation", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-annotate-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      const response = await callTool(child, "annotate_file", {
        filePath: "src/index.ts",
        text: "This is the main entry point",
        priority: "high",
      });

      assert.ok(response.result, "Should have result");
      assert.ok(response.result.content[0].text.includes("Annotation saved"));
      assert.ok(response.result.content[0].text.includes("src/index.ts"));
      assert.ok(response.result.content[0].text.includes("high"));
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("annotate_file with missing filePath returns error", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-annotate-err-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      const response = await callTool(child, "annotate_file", {
        text: "Missing file path",
      });

      assert.ok(response.result, "Should have result");
      assert.ok(response.result.content[0].text.includes("Error"));
      assert.ok(response.result.content[0].text.includes("filePath"));
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("log_behavior with valid args logs behavior", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-log-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      const response = await callTool(child, "log_behavior", {
        filePath: "src/index.ts",
        tool: "edit_file",
        success: true,
        traceId: "trace-123",
        sessionId: "session-123",
        hookPhase: "post-tool-use",
        durationMs: 17,
      });

      assert.ok(response.result, "Should have result");
      assert.ok(response.result.content[0].text.includes("Behavior logged"));
      assert.ok(response.result.content[0].text.includes("edit_file"));
      assert.ok(response.result.content[0].text.includes("success"));

      const row = getLatestBehaviorRow(fixtureRoot);
      const metadata = JSON.parse(row.metadata);
      assert.equal(row.agent_type, "auto");
      assert.equal(row.action, "tool:edit_file");
      assert.equal(row.file_path, "src/index.ts");
      assert.equal(metadata.pattern, "edit_file");
      assert.equal(metadata.tool, "edit_file");
      assert.equal(metadata.traceId, "trace-123");
      assert.equal(metadata.sessionId, "session-123");
      assert.equal(metadata.hookPhase, "post-tool-use");
      assert.equal(metadata.durationMs, 17);
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("log_behavior with non-boolean success returns error", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-log-err-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      const response = await callTool(child, "log_behavior", {
        filePath: "src/index.ts",
        tool: "edit_file",
        success: "yes", // Invalid: should be boolean
      });

      assert.ok(response.result, "Should have result");
      assert.ok(response.result.content[0].text.includes("Error"));
      assert.ok(response.result.content[0].text.includes("success"));
      assert.ok(response.result.content[0].text.includes("boolean"));
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("hidden log-behavior command stores trace metadata", () => {
  const fixtureRoot = createFixtureProject("agentmind-cli-log-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "log-behavior",
        "--file",
        "src/index.ts",
        "--tool",
        "Edit",
        "--success",
        "true",
        "--trace-id",
        "trace-cli",
        "--session-id",
        "session-cli",
        "--hook-phase",
        "post-tool-use",
        "--duration-ms",
        "21",
      ],
      { cwd: fixtureRoot, encoding: "utf-8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const row = getLatestBehaviorRow(fixtureRoot);
    const metadata = JSON.parse(row.metadata);
    assert.equal(row.agent_type, "agent");
    assert.equal(row.action, "tool:Edit");
    assert.equal(row.file_path, "src/index.ts");
    assert.equal(metadata.traceId, "trace-cli");
    assert.equal(metadata.sessionId, "session-cli");
    assert.equal(metadata.hookPhase, "post-tool-use");
    assert.equal(metadata.durationMs, 21);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("find_gaps returns response structure", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-gaps-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      const response = await callTool(child, "find_gaps", {});

      assert.ok(response.result, "Should have result");
      assert.ok(response.result.content, "Should have content");
      assert.ok(
        Array.isArray(response.result.content),
        "Content should be array",
      );
      assert.equal(response.result.content[0].type, "text");
      // Response should contain "Context Gaps" header or "No gaps found"
      const text = response.result.content[0].text;
      assert.ok(
        text.includes("Context Gaps") || text.includes("No gaps found"),
        "Response should mention gaps or no gaps found",
      );
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("find_gaps with directory filter returns response", async () => {
  const fixtureRoot = createFixtureProject("agentmind-mcp-gaps-dir-");

  try {
    const init = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: fixtureRoot,
      encoding: "utf-8",
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });

      const response = await callTool(child, "find_gaps", {
        directory: "src",
      });

      assert.ok(response.result, "Should have result");
      assert.ok(response.result.content[0].type, "text");
      // Response should be a valid text response
      assert.ok(typeof response.result.content[0].text === "string");
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
