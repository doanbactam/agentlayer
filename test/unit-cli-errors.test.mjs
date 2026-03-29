import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cliPath = path.resolve("dist/cli/index.js");

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
  });
}

function createTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmind-cli-"));
  return dir;
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

test("running status without init exits with error", () => {
  const dir = createTempDir();
  try {
    // No .agentmind folder - simulate uninitialized project
    const result = runCli(["status"], dir);
    assert.notEqual(result.status, 0, "status should fail without init");
    assert.ok(
      result.stderr.length > 0 ||
        result.stdout.includes("not initialized") ||
        result.stdout.includes("error"),
      "should have error message",
    );
  } finally {
    cleanup(dir);
  }
});

test("running annotate with non-existent file exits with error", () => {
  const dir = createTempDir();
  try {
    // Create .agentmind folder to simulate initialized project
    mkdirSync(path.join(dir, ".agentmind"), { recursive: true });

    const result = runCli(
      ["annotate", "non-existent-file.ts", "some annotation"],
      dir,
    );
    assert.notEqual(
      result.status,
      0,
      "annotate should fail with non-existent file",
    );
    assert.ok(
      result.stderr.length > 0 ||
        result.stdout.includes("not found") ||
        result.stdout.includes("error"),
      "should have error message",
    );
  } finally {
    cleanup(dir);
  }
});

test("running health without init exits with error", () => {
  const dir = createTempDir();
  try {
    // No .agentmind folder - simulate uninitialized project
    const result = runCli(["health"], dir);
    assert.notEqual(result.status, 0, "health should fail without init");
    assert.ok(
      result.stderr.length > 0 ||
        result.stdout.includes("not initialized") ||
        result.stdout.includes("error"),
      "should have error message",
    );
  } finally {
    cleanup(dir);
  }
});
