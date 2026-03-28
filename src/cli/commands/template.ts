import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import ora from "ora";
import { ContextStore } from "../../store/schema.js";
import {
  listTemplates,
  getTemplate,
  applyTemplate,
  autoApplyTemplates,
} from "../../templates/index.js";

export async function templateList(): Promise<void> {
  const templates = listTemplates();

  console.log(chalk.bold("\n  Available templates:\n"));

  for (const t of templates) {
    console.log(`  ${chalk.cyan(t.name.padEnd(15))} ${t.description}`);
    console.log(
      chalk.gray(
        `  ${"".padEnd(15)} ${t.rules.length} rules, ${t.patterns.length} patterns`,
      ),
    );
  }

  console.log("");
}

export async function templateApply(
  name: string | undefined,
  opts: { all?: boolean },
): Promise<void> {
  const cwd = process.cwd();
  const agentmindDir = path.join(cwd, ".agentmind");

  if (!fs.existsSync(agentmindDir)) {
    console.error(
      chalk.red("\n  agentmind is not initialized in this project."),
    );
    console.error(chalk.gray("  Run `agentmind init` first.\n"));
    process.exit(1);
  }

  const store = new ContextStore(cwd);
  try {
    if (opts.all) {
      await applyAll(store, cwd);
    } else if (name) {
      await applySingle(store, cwd, name);
    } else {
      console.error(
        chalk.red("\n  Provide a template name or use --all to auto-detect."),
      );
      console.log(
        chalk.gray(
          "  Usage: agentmind template apply <name>\n         agentmind template apply --all\n",
        ),
      );
      process.exit(1);
    }
  } finally {
    store.close();
  }
}

async function applySingle(
  store: ContextStore,
  cwd: string,
  name: string,
): Promise<void> {
  const template = getTemplate(name);
  if (!template) {
    console.error(chalk.red(`\n  Unknown template: ${name}`));
    console.log(
      chalk.gray(
        `  Available: ${listTemplates()
          .map((t) => t.name)
          .join(", ")}\n`,
      ),
    );
    process.exit(1);
  }

  const spinner = ora(`Applying ${template.description}...`).start();

  try {
    const result = await applyTemplate(name, cwd, store);
    spinner.succeed(
      `Applied ${template.description}: ${result.rulesAdded} rules added, ${result.patternsMatched} files matched`,
    );

    if (result.skipped.length > 0) {
      console.log(
        chalk.gray(`  Skipped (no matches): ${result.skipped.join(", ")}`),
      );
    }
  } catch (err) {
    spinner.fail("Failed to apply template");
    console.error(
      chalk.red(
        `\n  ${err instanceof Error ? err.message : "Unknown error"}\n`,
      ),
    );
    process.exit(1);
  }

  console.log("");
}

async function applyAll(store: ContextStore, cwd: string): Promise<void> {
  const spinner = ora("Detecting project stack...").start();

  try {
    const results = await autoApplyTemplates(cwd, store);

    if (results.size === 0) {
      spinner.warn("No matching templates detected for this project");
      return;
    }

    const templateNames = [...results.keys()];
    spinner.succeed(
      `Detected ${results.size} stack${results.size !== 1 ? "s" : ""}: ${templateNames.join(", ")}`,
    );

    let totalRules = 0;
    let totalMatches = 0;
    const allSkipped: string[] = [];

    for (const [name, result] of results) {
      const t = getTemplate(name)!;
      console.log(
        `  ${chalk.cyan(name.padEnd(15))} ${result.rulesAdded} rules added, ${result.patternsMatched} files matched`,
      );
      totalRules += result.rulesAdded;
      totalMatches += result.patternsMatched;
      allSkipped.push(...result.skipped);
    }

    if (allSkipped.length > 0) {
      console.log(
        chalk.gray(
          `\n  Skipped patterns (no file matches): ${allSkipped.length}`,
        ),
      );
    }

    console.log(
      chalk.bold(
        `\n  Total: ${totalRules} rules added across ${results.size} template(s)`,
      ),
    );
  } catch (err) {
    spinner.fail("Auto-detect failed");
    console.error(
      chalk.red(
        `\n  ${err instanceof Error ? err.message : "Unknown error"}\n`,
      ),
    );
    process.exit(1);
  }

  console.log("");
}
