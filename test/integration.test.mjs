import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import { ContextStore } from "../dist/store/schema.js";

const projectRoot = process.cwd();
const cliPath = path.join(projectRoot, "dist", "cli", "index.js");

function runCli(args, cwd = projectRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
  });
}

function runCliWithEnv(args, cwd, env) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...env },
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
        scripts: {
          custom: "node src/index.js",
        },
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

function insertAnnotation(root, filePath, text) {
  const store = new ContextStore(root);
  const db = store.getDb();
  try {
    db.run(
      `
      INSERT INTO context_entries (file_path, type, content, scope, priority, source)
      VALUES (?, 'annotation', ?, 'global', 'normal', 'test')
    `,
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

function createJsonlLine(id, filePath, text) {
  return `${JSON.stringify({
    id,
    type: "annotation",
    scope: "global",
    filePath,
    content: {
      id: `ann-${id}`,
      path: filePath,
      text,
      author: "test",
      created: Date.now(),
    },
    priority: "normal",
    source: "test",
    timestamp: new Date().toISOString(),
  })}\n`;
}

function installFakeGit(root, mode) {
  const binDir = path.join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });

  const gitJsPath = path.join(binDir, "git.js");
  writeFileSync(
    gitJsPath,
    [
      "#!/usr/bin/env node",
      'const mode = process.env.FAKE_GIT_MODE || "ok"',
      "const args = process.argv.slice(2)",
      'const command = args.join(" ")',
      "if (command === \"rev-parse --git-dir\") { console.log('.git'); process.exit(0) }",
      "if (command === \"status --porcelain .agentmind/context.jsonl\") { process.stdout.write(' M .agentmind/context.jsonl\\n'); process.exit(0) }",
      'if (command === "add .agentmind/context.jsonl") { process.exit(0) }',
      'if (args[0] === "commit") {',
      "  if (mode === \"commit-fail\") { console.error('commit blocked'); process.exit(1) }",
      "  process.exit(0)",
      "}",
      'if (command === "pull") {',
      "  if (mode === \"pull-fail\") { console.error('remote unavailable'); process.exit(1) }",
      "  console.log('Already up to date.'); process.exit(0)",
      "}",
      'if (command === "push") {',
      "  if (mode === \"push-fail\") { console.error('push blocked'); process.exit(1) }",
      "  process.exit(0)",
      "}",
      "process.exit(0)",
      "",
    ].join("\n"),
    "utf-8",
  );
  chmodSync(gitJsPath, 0o755);

  writeFileSync(
    path.join(binDir, "git.cmd"),
    `@echo off\r\n"${process.execPath}" "%~dp0git.js" %*\r\n`,
    "utf-8",
  );

  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = process.env[pathKey] ?? process.env.PATH ?? "";
  return {
    FAKE_GIT_MODE: mode,
    [pathKey]: `${binDir}${path.delimiter}${currentPath}`,
    PATH: `${binDir}${path.delimiter}${currentPath}`,
  };
}

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

test("serve exposes MCP tools over stdio", async () => {
  const fixtureRoot = createFixtureProject("agentmind-serve-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const child = spawn(process.execPath, [cliPath, "serve"], {
      cwd: fixtureRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      const initResponse = await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });
      assert.equal(initResponse.result.serverInfo.name, "agentmind");

      const toolsResponse = await requestJsonRpc(child, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      const names = toolsResponse.result.tools.map((tool) => tool.name);
      assert.deepEqual(names, [
        "get_context",
        "get_claims",
        "get_health",
        "annotate_file",
        "log_behavior",
        "find_gaps",
      ]);
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("pull --force aborts on invalid JSONL without wiping local store", () => {
  const fixtureRoot = createFixtureProject("agentmind-pull-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const storeBefore = new ContextStore(fixtureRoot);
    const beforeCount = storeBefore
      .getDb()
      .query("SELECT COUNT(*) as c FROM context_entries")
      .get().c;
    storeBefore.close();
    assert.ok(beforeCount >= 0);

    writeFileSync(
      path.join(fixtureRoot, ".agentmind", "context.jsonl"),
      "{not json}\n",
      "utf-8",
    );

    const pull = runCli(["pull", "--force"], fixtureRoot);
    assert.equal(pull.status, 0, pull.stderr || pull.stdout);
    assert.match(pull.stdout, /contains no valid entries\. Import aborted\./);

    const storeAfter = new ContextStore(fixtureRoot);
    const afterCount = storeAfter
      .getDb()
      .query("SELECT COUNT(*) as c FROM context_entries")
      .get().c;
    storeAfter.close();
    assert.equal(afterCount, beforeCount);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("push exports JSONL in a non-git project", () => {
  const fixtureRoot = createFixtureProject("agentmind-push-local-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    insertAnnotation(fixtureRoot, "src/index.ts", "local note");

    const push = runCli(["push"], fixtureRoot);
    assert.equal(push.status, 0, push.stderr || push.stdout);
    assert.match(
      push.stdout,
      /Pushed \d+ entries to \.agentmind\/context\.jsonl/,
    );
    assert.match(
      push.stdout,
      /Not a git repository\. JSONL export is local only\./,
    );

    const jsonl = readFileSync(
      path.join(fixtureRoot, ".agentmind", "context.jsonl"),
      "utf-8",
    );
    assert.match(jsonl, /local note/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("push keeps local export when git commit fails", () => {
  const fixtureRoot = createFixtureProject("agentmind-push-gitfail-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    insertAnnotation(fixtureRoot, "src/index.ts", "git failure note");

    const env = installFakeGit(fixtureRoot, "commit-fail");
    const push = runCliWithEnv(["push"], fixtureRoot, env);
    assert.equal(push.status, 0, push.stderr || push.stdout);
    assert.match(push.stdout, /Git commit failed:/);
    assert.match(push.stdout, /updated locally but was not committed/);

    const jsonl = readFileSync(
      path.join(fixtureRoot, ".agentmind", "context.jsonl"),
      "utf-8",
    );
    assert.match(jsonl, /git failure note/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("pull continues with local JSONL when git pull fails", () => {
  const fixtureRoot = createFixtureProject("agentmind-pull-gitfail-");

  try {
    const init = runCli(["init"], fixtureRoot);
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const jsonlPath = path.join(fixtureRoot, ".agentmind", "context.jsonl");
    const original = readFileSync(jsonlPath, "utf-8");
    writeFileSync(
      jsonlPath,
      `${original}${createJsonlLine(999001, "src/index.ts", "pulled despite git failure")}`,
      "utf-8",
    );

    const env = installFakeGit(fixtureRoot, "pull-fail");
    const pull = runCliWithEnv(["pull"], fixtureRoot, env);
    assert.equal(pull.status, 0, pull.stderr || pull.stdout);
    assert.match(pull.stdout, /Git pull failed:/);
    assert.match(pull.stdout, /Continuing with local context\.jsonl/);
    assert.match(pull.stdout, /Pulled 1 new entries, \d+ existing, 0 removed/);

    const store = new ContextStore(fixtureRoot);
    const row = store
      .getDb()
      .query(
        `
      SELECT COUNT(*) as c FROM context_entries
      WHERE type = 'annotation' AND file_path = 'src/index.ts'
    `,
      )
      .get();
    store.close();
    assert.ok(row.c >= 1);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("npm pack dry-run publishes only distributable files", () => {
  const pack =
    process.platform === "win32"
      ? spawnSync(
          "cmd.exe",
          ["/c", "npm", "pack", "--dry-run", "--ignore-scripts"],
          {
            cwd: projectRoot,
            encoding: "utf-8",
          },
        )
      : spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts"], {
          cwd: projectRoot,
          encoding: "utf-8",
        });

  const output = `${pack.stdout ?? ""}${pack.stderr ?? ""}`;
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  assert.doesNotMatch(output, /npm notice .*src\//);
  assert.doesNotMatch(output, /npm notice .*test\//);
  assert.doesNotMatch(output, /npm notice .*\.agentmind\//);
  assert.doesNotMatch(output, /npm notice .*agentmind_spec\.docx/);
  assert.match(output, /npm notice .*README\.md/);
  assert.match(output, /npm notice .*dist\/cli\/index\.js/);
  assert.match(output, /npm notice .*LICENSE/);
});
