import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const cliPath = path.join(projectRoot, "dist", "cli", "index.js");

function runCli(args, cwd = projectRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
  });
}

function hasHookCommand(hooks, scriptName) {
  const pattern = new RegExp(
    `node \\.agentmind[\\\\/]hooks[\\\\/]${scriptName.replace(".", "\\.")}$`,
  );
  return hooks?.some((hook) =>
    hook.hooks.some((command) => pattern.test(command)),
  );
}

test("claude hooks install post-commit and use node runtime", () => {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), "agentmind-hooks-claude-"),
  );

  try {
    mkdirSync(path.join(fixtureRoot, ".claude"), { recursive: true });

    const install = runCli(["hooks", "claude"], fixtureRoot);
    assert.equal(install.status, 0, install.stderr || install.stdout);

    const settingsPath = path.join(
      fixtureRoot,
      ".claude",
      "settings.local.json",
    );
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));

    assert.ok(hasHookCommand(settings.hooks?.PostToolUse, "post-tool-use.mjs"));
    assert.ok(hasHookCommand(settings.hooks?.PostCommit, "post-commit.mjs"));

    assert.ok(
      existsSync(
        path.join(fixtureRoot, ".agentmind", "hooks", "post-tool-use.mjs"),
      ),
    );
    assert.ok(
      existsSync(
        path.join(fixtureRoot, ".agentmind", "hooks", "post-commit.mjs"),
      ),
    );

    const config = JSON.parse(
      readFileSync(
        path.join(fixtureRoot, ".agentmind", "config.json"),
        "utf-8",
      ),
    );
    assert.ok(Array.isArray(config.command));
    assert.equal(config.command[0], process.execPath);
    assert.match(config.command[1], /dist[\\/]cli[\\/]index\.js$/);

    const uninstall = runCli(["unhook", "claude"], fixtureRoot);
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
    assert.ok(
      !existsSync(
        path.join(fixtureRoot, ".agentmind", "hooks", "post-commit.mjs"),
      ),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("codex hooks install with node runtime and uninstall cleans generated hooks", () => {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), "agentmind-hooks-codex-"),
  );

  try {
    const install = runCli(["hooks", "codex"], fixtureRoot);
    assert.equal(install.status, 0, install.stderr || install.stdout);

    const configPath = path.join(fixtureRoot, ".codex", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    assert.match(
      config.hooks.postToolUse,
      /^node \.agentmind[\\/]hooks[\\/]post-tool-use\.mjs$/,
    );
    assert.match(
      config.hooks.onFileChange,
      /^node \.agentmind[\\/]hooks[\\/]post-commit\.mjs$/,
    );

    assert.ok(
      existsSync(
        path.join(fixtureRoot, ".agentmind", "hooks", "post-commit.mjs"),
      ),
    );

    const uninstall = runCli(["unhook", "codex"], fixtureRoot);
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
    assert.ok(
      !existsSync(
        path.join(fixtureRoot, ".agentmind", "hooks", "post-tool-use.mjs"),
      ),
    );
    assert.ok(
      !existsSync(
        path.join(fixtureRoot, ".agentmind", "hooks", "post-commit.mjs"),
      ),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
