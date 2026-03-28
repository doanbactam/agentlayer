#!/usr/bin/env node

import { Command } from "commander"
import { init } from "./commands/init.js"
import { scan } from "./commands/scan.js"
import { status } from "./commands/status.js"
import { annotate } from "./commands/annotate.js"
import { hooks, unhook } from "./commands/hooks.js"
import { inject } from "./commands/inject.js"
import { logBehavior } from "./commands/log-behavior.js"
import { showBehaviors } from "./commands/behaviors.js"
import { insights } from "./commands/insights.js"
import { learn } from "./commands/learn.js"
import { agents } from "./commands/agents.js"
import { register, claim, release, bridgeStatus, conflicts } from "./commands/bridge.js"
import { sync } from "./commands/sync.js"
import { share } from "./commands/share.js"
import { health } from "./commands/health.js"
import { overlay } from "./commands/overlay.js"
import { push } from "./commands/push.js"
import { pull } from "./commands/pull.js"
import { serve } from "./commands/serve.js"
import { templateList, templateApply } from "./commands/template.js"

const program = new Command()

program
  .name("agentmind")
  .description("Intelligent context routing for AI coding agents")
  .version("0.1.0")

program
  .command("init")
  .description("Initialize agentmind in the current project")
  .action(init)

program
  .command("scan")
  .description("Scan project files and build context map")
  .option("-f, --force", "Force full rescan")
  .option("--json", "Output as JSON")
  .action(scan)

program
  .command("status")
  .description("Show agentmind status and health")
  .action(status)

program
  .command("health")
  .description("Show context health dashboard with coverage, staleness, and recommendations")
  .option("--json", "Output as JSON")
  .action(health)

program
  .command("annotate")
  .description("Add context annotation to a file")
  .argument("<path>", "File path to annotate")
  .argument("[text]", "Annotation text")
  .option("-l, --line <number>", "Line number")
  .action(annotate)

program
  .command("hooks")
  .description("Install hooks for an AI agent")
  .argument("<agent>", "Agent to install hooks for (claude|codex)")
  .action(hooks)

program
  .command("inject")
  .description("Inject context into current agent session")
  .argument("[query]", "Query to route context for")
  .option("-f, --file <path>", "Get context for a specific file")
  .action(inject)

program
  .command("log-behavior", { hidden: true })
  .description("Internal: log agent behavior")
  .option("-f, --file <path>", "File path")
  .option("-t, --tool <name>", "Tool name")
  .option("-e, --event <name>", "Event type")
  .option("-s, --success <bool>", "Success status")
  .action(logBehavior)

program
  .command("behaviors")
  .description("Show recent agent behavior log")
  .option("-n, --limit <number>", "Number of entries", "20")
  .action(showBehaviors)

program
  .command("insights")
  .description("Analyze behavior patterns and find failure hotspots")
  .option("--json", "Output as JSON")
  .action(insights)

program
  .command("learn")
  .description("Analyze behavior patterns and auto-generate rules")
  .option("--apply", "Auto-apply high-confidence rules (>=0.8)")
  .option("--force", "Apply all rules >=0.5 (use with --apply)")
  .option("--json", "Output as JSON")
  .action(learn)

program
  .command("unhook")
  .description("Remove hooks for an AI agent")
  .argument("<agent>", "Agent to remove hooks for (claude|codex)")
  .action(unhook)

program
  .command("agents")
  .description("Show active agents and detect conflicts")
  .action(agents)

program
  .command("bridge")
  .description("Multi-agent state bridge commands")
  .addCommand(
    new Command("register")
      .description("Register an agent")
      .requiredOption("--id <id>", "Agent ID")
      .requiredOption("--tool <tool>", "Tool name")
      .action(register)
  )
  .addCommand(
    new Command("claim")
      .description("Claim files for editing")
      .requiredOption("--id <id>", "Agent ID")
      .requiredOption("--files <files...>", "Files to claim")
      .action(claim)
  )
  .addCommand(
    new Command("release")
      .description("Release claimed files")
      .requiredOption("--id <id>", "Agent ID")
      .requiredOption("--files <files...>", "Files to release")
      .action(release)
  )
  .addCommand(
    new Command("status")
      .description("Show bridge status")
      .action(bridgeStatus)
  )
  .addCommand(
    new Command("conflicts")
      .description("Show file conflicts")
      .action(conflicts)
  )

program
  .command("sync")
  .description("Sync context to editor rule files (.cursorrules, .windsurfrules)")
  .argument("[tool]", "Target tool (cursor, windsurf). Default: all")
  .option("--dry-run", "Preview without writing files")
  .action((tool, opts) => sync({ tool: tool ?? opts.tool, dryRun: opts.dryRun }))

program
  .command("unsync")
  .description("Remove agentmind context from editor rule files")
  .argument("[tool]", "Target tool (cursor, windsurf). Default: all")
  .action((tool) => sync({ tool: tool ?? undefined, remove: true }))

program
  .command("share")
  .description("Export context snapshot")
  .option("-f, --format <format>", "Output format: json, markdown, or curl", "json")
  .option("-o, --output <file>", "Write to file instead of stdout")
  .action(share)

program
  .command("overlay")
  .description("Interactive annotation overlay — browse files needing context")
  .option("--json", "Output gaps as JSON (non-interactive)")
  .action(overlay)

program
  .command("push")
  .description("Commit context changes")
  .option("-m, --message <msg>", "Commit message")
  .option("--remote", "Push to remote after committing")
  .action(push)

program
  .command("pull")
  .description("Pull remote context changes")
  .option("--force", "Force reimport all entries")
  .action(pull)

program
  .command("serve")
  .description("Start MCP server for agent integration")
  .action(serve)

program
  .command("template")
  .description("Manage pre-built context templates for popular stacks")
  .addCommand(
    new Command("list")
      .description("Show available templates")
      .action(templateList)
  )
  .addCommand(
    new Command("apply")
      .description("Apply a template to the current project")
      .argument("[name]", "Template name to apply")
      .option("--all", "Auto-detect and apply matching templates")
      .action(templateApply)
  )

program.parse()
