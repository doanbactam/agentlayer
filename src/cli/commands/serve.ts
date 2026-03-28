import { startServer } from "../../mcp/server.js"

export async function serve(): Promise<void> {
  const projectRoot = process.cwd()

  process.stderr.write("[agentmind] MCP server starting on stdio...\n")
  process.stderr.write(`[agentmind] Project: ${projectRoot}\n\n`)

  process.stderr.write("To connect Claude Code, add to .claude/settings.local.json:\n")
  process.stderr.write(JSON.stringify({
    mcpServers: {
      agentmind: {
        command: "agentmind",
        args: ["serve"],
      },
    },
  }, null, 2) + "\n\n")

  startServer(projectRoot)
}
