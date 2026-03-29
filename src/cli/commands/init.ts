import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { ContextStore } from "../../store/schema.js";

export async function init() {
  const cwd = process.cwd();
  const agentmindDir = path.join(cwd, ".agentmind");
  const jsonlPath = path.join(agentmindDir, "context.jsonl");

  const isProject = detectProject(cwd);
  if (!isProject) {
    console.error(chalk.red("\n  No project detected in current directory."));
    console.error(
      chalk.gray(
        "  Run this command from a project root (needs package.json, .git, or source files).\n",
      ),
    );
    process.exit(1);
  }

  if (fs.existsSync(agentmindDir)) {
    console.error(
      chalk.yellow("\n  agentmind is already initialized in this project."),
    );
    console.error(chalk.gray("  Run `agentmind status` to inspect context.\n"));
    process.exit(1);
  }

  fs.mkdirSync(agentmindDir, { recursive: true });

  const store = new ContextStore(cwd);
  try {
    fs.writeFileSync(jsonlPath, "", "utf-8");
  } finally {
    store.close();
  }

  updateGitignore(cwd);

  console.log("");
  console.log(
    chalk.green("  \u2713") +
      ` Initialized ${chalk.bold(".agentmind/")} in this project`,
  );
  console.log(
    chalk.green("  \u2713") +
      ` Context store: ${chalk.cyan(".agentmind/context.db")}`,
  );
  console.log(
    chalk.green("  \u2713") +
      ` Git-ready: ${chalk.cyan(".agentmind/context.jsonl")}`,
  );
  console.log("");

  console.log(
    chalk.gray(
      `  Next: ${chalk.white("`agentmind status`")} to check context health`,
    ),
  );
  console.log("");
}

function detectProject(cwd: string): boolean {
  const markers = [
    "package.json",
    ".git",
    "tsconfig.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "pom.xml",
    "Gemfile",
    "Makefile",
  ];

  for (const marker of markers) {
    if (fs.existsSync(path.join(cwd, marker))) return true;
  }

  // Check for source files
  {
    const files = fs.readdirSync(cwd);
    if (files.some((f) => f.match(/\.(ts|js|tsx|jsx|py|go|rs|java)$/))) {
      return true;
    }
  }

  return false;
}

function updateGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, ".gitignore");
  const entry = ".agentmind/context.db";

  if (!fs.existsSync(gitignorePath)) return;

  const content = fs.readFileSync(gitignorePath, "utf-8");
  if (content.includes(entry)) return;

  const newContent =
    content.trimEnd() + "\n\n# agentmind\n.agentmind/context.db\n";
  fs.writeFileSync(gitignorePath, newContent);
}
