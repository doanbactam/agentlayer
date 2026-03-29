import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ContextStore } from "../dist/store/schema.js";

const projectRoot = process.cwd();
const cliPath = path.join(projectRoot, "dist", "cli", "index.js");

function runCli(args, cwd = projectRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
  });
}

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
    ["export function main() {", "  return process.platform", "}", ""].join(
      "\n",
    ),
  );
  writeFileSync(
    path.join(fixtureRoot, "src", "utils.ts"),
    [
      "export function add(a: number, b: number) {",
      "  return a + b",
      "}",
      "",
    ].join("\n"),
  );
  return fixtureRoot;
}

function insertAnnotation(root, filePath, text) {
  const store = new ContextStore(root);
  try {
    store
      .getDb()
      .run(
        "INSERT INTO context_entries (file_path, type, content, scope, priority, source) VALUES (?, 'annotation', ?, 'global', 'normal', 'test')",
        [
          filePath,
          JSON.stringify({
            id: `ann-${Date.now()}`,
            path: filePath,
            text,
            author: "test",
            created: Date.now(),
          }),
        ],
      );
  } finally {
    store.close();
  }
}

test("full init-annotate-status workflow", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-workflow-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);
    assert.ok(existsSync(path.join(fixtureRoot, ".agentmind", "context.db")));
    assert.ok(
      existsSync(path.join(fixtureRoot, ".agentmind", "context.jsonl")),
    );

    insertAnnotation(
      fixtureRoot,
      "src/index.ts",
      "Main entry point for the app",
    );

    const status = runCli(["status"], fixtureRoot);
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, /Context coverage:/);

    const verifyStore = new ContextStore(fixtureRoot);
    const row = verifyStore
      .getDb()
      .query(
        "SELECT COUNT(*) as c FROM context_entries WHERE type = 'annotation' AND file_path = 'src/index.ts'",
      )
      .get();
    verifyStore.close();
    assert.ok(row.c >= 1);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("health command shows coverage info after init", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-health-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const health = runCli(["health"], fixtureRoot);
    assert.equal(health.status, 0, health.stderr || health.stdout);
    assert.match(health.stdout, /agentmind health/);
    assert.match(health.stdout, /Coverage by directory/);

    const healthJson = runCli(["health", "--json"], fixtureRoot);
    assert.equal(healthJson.status, 0, healthJson.stderr || healthJson.stdout);
    const parsed = JSON.parse(healthJson.stdout);
    assert.ok(Array.isArray(parsed.dirCoverage));
    assert.ok(Array.isArray(parsed.classifications));
    assert.ok(Array.isArray(parsed.recommendations));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("share exports context as JSON file", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-share-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    insertAnnotation(fixtureRoot, "src/index.ts", "Test annotation for export");

    const outputPath = path.join(fixtureRoot, "context.json");
    const share = runCli(
      ["share", "-f", "json", "-o", "context.json"],
      fixtureRoot,
    );
    assert.equal(share.status, 0, share.stderr || share.stdout);
    assert.ok(existsSync(outputPath));

    const parsed = JSON.parse(readFileSync(outputPath, "utf-8"));
    assert.equal(parsed.version, "1.0");
    assert.ok(Array.isArray(parsed.entries));
    assert.ok(parsed.meta);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("log-behavior, behaviors, and insights work together", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-behaviors-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const log1 = runCli(
      [
        "log-behavior",
        "-f",
        "src/index.ts",
        "-t",
        "edit",
        "-e",
        "tool-use",
        "-s",
        "true",
      ],
      fixtureRoot,
    );
    assert.equal(log1.status, 0, log1.stderr || log1.stdout);

    const log2 = runCli(
      [
        "log-behavior",
        "-f",
        "src/utils.ts",
        "-t",
        "edit",
        "-e",
        "tool-use",
        "-s",
        "false",
      ],
      fixtureRoot,
    );
    assert.equal(log2.status, 0, log2.stderr || log2.stdout);

    const behaviors = runCli(["behaviors", "-n", "10"], fixtureRoot);
    assert.equal(behaviors.status, 0, behaviors.stderr || behaviors.stdout);
    assert.match(behaviors.stdout, /Recent agent behavior/);

    const insights = runCli(["insights"], fixtureRoot);
    assert.equal(insights.status, 0, insights.stderr || insights.stdout);
    assert.match(insights.stdout, /agentmind insights/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("bridge register and status work correctly", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-bridge-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const register = runCli(
      ["bridge", "register", "--id", "test-agent-1", "--tool", "claude"],
      fixtureRoot,
    );
    assert.equal(register.status, 0, register.stderr || register.stdout);
    assert.match(register.stdout, /registered test-agent-1/);

    const status = runCli(["bridge", "status"], fixtureRoot);
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, /active agents/);
    assert.match(status.stdout, /test-agent-1/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("push exports entries to context.jsonl", () => {
  const fixtureRoot = createFixtureProject("agentmind-e2e-push-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    insertAnnotation(fixtureRoot, "src/index.ts", "push test annotation");

    const push = runCli(["push"], fixtureRoot);
    assert.equal(push.status, 0, push.stderr || push.stdout);
    assert.match(
      push.stdout,
      /Pushed \d+ entries to \.agentmind\/context\.jsonl/,
    );

    const jsonl = readFileSync(
      path.join(fixtureRoot, ".agentmind", "context.jsonl"),
      "utf-8",
    );
    assert.match(jsonl, /push test annotation/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
