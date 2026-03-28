import type { ContextTemplate } from "./registry.js"

export function goTemplate(): ContextTemplate {
  return {
    name: "go",
    description: "Go — standard module layout",
    patterns: [
      { glob: "go.mod", classification: "config" },
      { glob: "cmd/**/main.go", classification: "source" },
      { glob: "internal/**", classification: "source" },
      { glob: "api/**", classification: "source" },
    ],
    rules: [
      {
        pattern: "go.mod",
        description: "Go module definition",
        priority: "critical",
      },
      {
        pattern: "cmd/**/main.go",
        description: "CLI entry point",
        priority: "high",
      },
      {
        pattern: "internal/**",
        description: "Internal package — not importable outside module",
        priority: "high",
      },
      {
        pattern: "api/**",
        description: "API handlers",
        priority: "high",
      },
    ],
  }
}
