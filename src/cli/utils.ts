import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type {
  ContextEntry,
  FileClassification,
  FileInfo,
} from "../types/index.js";

type Matcher = [RegExp, FileClassification];

const PATH_MATCHERS: Matcher[] = [
  [/(^|\/)(node_modules)\//, "vendor"],
  [/\.agentmind\//, "generated"],
  [/(^|\/)(dist|\.next|coverage|build|out|\.output)\//, "build"],
  [/\.min\.(js|css)$/, "generated"],
  [/(^|\/)(__tests__|test|tests|spec|specs)\//, "test"],
  [/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/, "test"],
  [/_test\.(go|rs)$/, "test"],
  [/\.md$/, "docs"],
  [/(^|\/)docs\//, "docs"],
  [/LICENSE|CHANGELOG|CONTRIBUTING/, "docs"],
  [/\.(css|scss|sass|less|styled|module\.css)$/, "asset"],
  [/\.config\.(ts|js|mjs|cjs)$/, "config"],
  [/^\.github\//, "config"],
  [/^Dockerfile/, "config"],
  [/^docker-compose/, "config"],
  [/^tsconfig/, "config"],
  [/^\.env/, "config"],
  [/\.(lock|lockfile)$/, "config"],
  [
    /^(package\.json|turbo\.json|nx\.json|lerna\.json|pnpm-workspace\.yaml)$/,
    "config",
  ],
  [/\.(json|yaml|yml|toml|xml|csv|proto|graphql|gql)$/, "data"],
  [/\.(sql|prisma|drizzle)$/, "data"],
  [/\.(png|jpg|jpeg|gif|svg|ico|webp|avif|mp4|mp3|woff2?|ttf|eot)$/, "asset"],
];

const SOURCE_EXTS = new Set([
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
  ".kt",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".scala",
  ".clj",
  ".ex",
  ".exs",
  ".erl",
  ".hs",
  ".ml",
  ".vim",
  ".el",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".html",
  ".htm",
  ".vue",
  ".svelte",
  ".zig",
  ".nim",
  ".lua",
  ".php",
]);

function shouldSkipDirectory(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "dist";
}

export function classifyFilePath(filePath: string): FileClassification {
  const normalized = filePath.replace(/\\/g, "/");
  for (const [re, cls] of PATH_MATCHERS) {
    if (re.test(normalized)) return cls;
  }

  const ext = extname(normalized);
  if (SOURCE_EXTS.has(ext)) return "source";
  if (/(^|\/)index\.(ts|js|mjs)$/.test(normalized)) return "source";
  return "data";
}

export function collectProjectFiles(root: string): {
  files: FileInfo[];
  classifications: Map<string, FileClassification>;
} {
  const files: FileInfo[] = [];
  const classifications = new Map<string, FileClassification>();

  const walk = (dir: string): void => {
    let entries: import("node:fs").Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;

      const absolutePath = join(dir, entry.name);
      let stats: import("node:fs").Stats;
      try {
        stats = statSync(absolutePath);
      } catch {
        continue;
      }

      const relativePath = relative(root, absolutePath).replace(/\\/g, "/");
      const classification = classifyFilePath(relativePath);

      files.push({
        path: relativePath,
        size: stats.size,
        modified: stats.mtimeMs,
        hash: "",
      });
      classifications.set(relativePath, classification);
    }
  };

  walk(root);
  return { files, classifications };
}

export function formatContext(entries: ContextEntry[]): string {
  const lines: string[] = [
    "# Agentmind Context",
    "",
    "Relevant context from the project knowledge base:",
    "",
  ];

  for (const e of entries) {
    lines.push(`## ${e.path}`);
    lines.push("");

    if (e.classification) {
      lines.push(`Classification: ${e.classification}`);
      lines.push("");
    }

    if (e.annotations.length > 0) {
      lines.push("### Annotations");
      for (const a of e.annotations) {
        const lineRef = a.line ? ` (line ${a.line})` : "";
        lines.push(`- ${a.text}${lineRef}`);
      }
      lines.push("");
    }

    if (e.rules.length > 0) {
      lines.push("### Rules");
      for (const r of e.rules) {
        lines.push(`- ${r.pattern}: ${r.description}`);
      }
      lines.push("");
    }

    if (e.behaviors.length > 0) {
      lines.push("### Observed Patterns");
      for (const b of e.behaviors) {
        lines.push(`- ${b.pattern}: ${b.description} (${b.frequency}x)`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validatePriority(input: string): string {
  const valid = ["critical", "high", "normal", "low"];
  const lower = input.toLowerCase();
  return valid.includes(lower) ? lower : "normal";
}

export function isGitRepo(root: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: root, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
