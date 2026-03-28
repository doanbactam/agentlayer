import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { NonInferablePattern, FileInfo } from "../types/index.js";

const standardScripts = new Set([
  "start",
  "build",
  "test",
  "lint",
  "format",
  "dev",
  "preview",
  "preinstall",
  "postinstall",
  "prepare",
  "prepublishOnly",
]);

const interestingFields = [
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "overrides",
  "resolutions",
  "pnpm",
];

async function readText(root: string, rel: string): Promise<string | null> {
  try {
    return await readFile(`${root}/${rel}`, "utf-8");
  } catch {
    return null;
  }
}

function pat(
  path: string,
  pattern: string,
  reason: string,
  line?: number,
  snippet?: string,
): NonInferablePattern {
  return { path, pattern, reason, line, snippet };
}

async function checkPackageJson(root: string): Promise<NonInferablePattern[]> {
  const raw = await readText(root, "package.json");
  if (!raw) return [];
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw);
  } catch {
    // Malformed package.json - skip pattern detection
    return [];
  }
  const out: NonInferablePattern[] = [];

  // non-standard scripts
  const scripts = pkg.scripts ?? {};
  for (const [name, cmd] of Object.entries(scripts)) {
    if (standardScripts.has(name)) continue;
    const prefix = name.match(/^(pre|post)(.+)/);
    if (prefix && standardScripts.has(prefix[2])) {
      out.push(
        pat(
          "package.json",
          `lifecycle:${name}`,
          `Lifecycle hook wrapping "${prefix[2]}" — runs implicitly`,
        ),
      );
      continue;
    }
    out.push(
      pat(
        "package.json",
        `custom-script:${name}`,
        `Custom script: ${String(cmd).slice(0, 60)}`,
      ),
    );
  }

  // package manager
  if (pkg.packageManager) {
    out.push(
      pat(
        "package.json",
        "package-manager",
        `Locked package manager: ${pkg.packageManager}`,
      ),
    );
  }
  // bun lockfile
  if (existsSync(`${root}/bun.lockb`) || existsSync(`${root}/bun.lock`)) {
    out.push(
      pat(
        "bun.lock",
        "package-manager",
        "Uses Bun as package manager (not npm/yarn/pnpm)",
      ),
    );
  }

  // hidden deps
  for (const field of interestingFields) {
    const val = pkg[field];
    if (!val || typeof val !== "object") continue;
    const keys = Object.keys(val);
    if (keys.length === 0) continue;
    out.push(
      pat(
        "package.json",
        `hidden-dep:${field}`,
        `${keys.length} ${field}: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? " ..." : ""}`,
      ),
    );
  }

  // native modules
  const deps = {
    ...((pkg.dependencies as Record<string, unknown>) ?? {}),
    ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
  };
  const nativeHints = ["native", "node-gyp", "napi", "ffi", "wasm", ".node"];
  for (const [name] of Object.entries(deps ?? {})) {
    if (nativeHints.some((h) => name.toLowerCase().includes(h))) {
      out.push(
        pat(
          "package.json",
          "native-module",
          `Native module dependency: ${name}`,
        ),
      );
    }
  }

  return out;
}

async function checkEnvFiles(root: string): Promise<NonInferablePattern[]> {
  const out: NonInferablePattern[] = [];
  const envFiles = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging",
    ".env.development",
  ];
  for (const f of envFiles) {
    const raw = await readText(root, f);
    if (!raw) continue;
    const keys = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split("=")[0])
      .filter(Boolean);
    if (keys.length > 0) {
      out.push(
        pat(
          f,
          "env-required",
          `Requires env vars: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? " ..." : ""}`,
        ),
      );
    }
  }
  return out;
}

const MAX_SCAN_SIZE = 200_000;

const textExts = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".vue",
  ".svelte",
]);

const contentPatterns: [RegExp, string, string][] = [
  [/@deprecated/, "deprecated", "Deprecated marker found"],
  [/TODO\s*[\(:]/, "todo", "TODO comment found"],
  [/FIXME\s*[\(:]/, "fixme", "FIXME comment found"],
  [/HACK\s*[\(:]/, "hack", "HACK comment found"],
  [/process\.platform/, "platform-check", "Platform-specific code detected"],
  [/process\.arch/, "platform-check", "Architecture-specific code detected"],
  [/docker|container/i, "docker-ref", "References Docker/container"],
];

async function scanFileContent(
  root: string,
  file: FileInfo,
): Promise<NonInferablePattern[]> {
  // skip large files, binary-ish extensions
  if (file.size > MAX_SCAN_SIZE) return [];
  const ext = file.path.slice(file.path.lastIndexOf("."));
  if (!textExts.has(ext)) return [];

  const raw = await readText(root, file.path);
  if (!raw) return [];

  const out: NonInferablePattern[] = [];
  const lines = raw.split("\n");

  for (const [re, pattern, reason] of contentPatterns) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        out.push(
          pat(file.path, pattern, reason, i + 1, lines[i].trim().slice(0, 80)),
        );
        break; // one match per pattern per file
      }
    }
  }

  // barrel export detection
  if (/(^|\/)index\.(ts|js)$/.test(file.path)) {
    const reexportCount = lines.filter(
      (l) => /^\s*export \* from/.test(l) || /^\s*export \{.*\} from/.test(l),
    ).length;
    if (reexportCount >= 3) {
      out.push(
        pat(
          file.path,
          "barrel-export",
          `Barrel file with ${reexportCount} re-exports`,
          undefined,
          undefined,
        ),
      );
    }
  }

  return out;
}

async function checkMonorepo(root: string): Promise<NonInferablePattern[]> {
  const out: NonInferablePattern[] = [];
  const markers = [
    ["pnpm-workspace.yaml", "pnpm workspace"],
    ["lerna.json", "Lerna monorepo"],
    ["turbo.json", "Turborepo"],
    ["nx.json", "Nx monorepo"],
  ];
  for (const [file, label] of markers) {
    if (existsSync(`${root}/${file}`)) {
      out.push(pat(file, "monorepo", `${label} detected`));
    }
  }
  // workspaces in package.json
  const raw = await readText(root, "package.json");
  if (raw) {
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(raw);
    } catch {
      // Malformed package.json - skip monorepo detection
      return out;
    }
    if (pkg.workspaces) {
      out.push(
        pat(
          "package.json",
          "monorepo",
          `npm/yarn workspaces: ${JSON.stringify(pkg.workspaces).slice(0, 80)}`,
        ),
      );
    }
  }
  return out;
}

export async function detectPatterns(
  root: string,
  files: FileInfo[],
): Promise<NonInferablePattern[]> {
  const out: NonInferablePattern[] = [];

  // structural checks
  const [pkg, env, mono] = await Promise.all([
    checkPackageJson(root),
    checkEnvFiles(root),
    checkMonorepo(root),
  ]);
  out.push(...pkg, ...env, ...mono);

  // content scans — limit to source/test files, batch
  const toScan = files.filter((f) => {
    if (f.size > MAX_SCAN_SIZE) return false;
    const ext = f.path.slice(f.path.lastIndexOf("."));
    return textExts.has(ext);
  });

  // scan in chunks to avoid fd exhaustion
  const chunkSize = 50;
  for (let i = 0; i < toScan.length; i += chunkSize) {
    const chunk = toScan.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map((f) => scanFileContent(root, f)),
    );
    for (const r of results) out.push(...r);
  }

  return out;
}
