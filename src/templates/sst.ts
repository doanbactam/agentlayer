import type { ContextTemplate } from "./registry.js";

export function sstTemplate(): ContextTemplate {
  return {
    name: "sst",
    description: "SST Ion — serverless infrastructure as code",
    patterns: [
      { glob: "sst.config.ts", classification: "config" },
      { glob: "stacks/*.ts", classification: "source" },
      { glob: "packages/*/package.json", classification: "config" },
      { glob: ".sst/**", classification: "generated" },
    ],
    rules: [
      {
        pattern: "sst.config.ts",
        description: "SST Ion config — defines stacks and resources",
        priority: "critical",
      },
      {
        pattern: "stacks/*.ts",
        description: "Infrastructure stack definition",
        priority: "high",
      },
      {
        pattern: "packages/*/package.json",
        description: "Monorepo package",
        priority: "normal",
      },
      {
        pattern: ".sst/**",
        description: "SST state directory — auto-generated, do not edit",
        priority: "critical",
      },
    ],
  };
}
