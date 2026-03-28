import type { ContextTemplate } from "./registry.js";

export function rustTemplate(): ContextTemplate {
  return {
    name: "rust",
    description: "Rust — Cargo-based project layout",
    patterns: [
      { glob: "Cargo.toml", classification: "config" },
      { glob: "src/main.rs", classification: "source" },
      { glob: "src/lib.rs", classification: "source" },
      { glob: "tests/**", classification: "test" },
      { glob: "benches/**", classification: "test" },
    ],
    rules: [
      {
        pattern: "Cargo.toml",
        description: "Rust package manifest",
        priority: "critical",
      },
      {
        pattern: "src/main.rs",
        description: "Binary entry point",
        priority: "high",
      },
      {
        pattern: "src/lib.rs",
        description: "Library root",
        priority: "high",
      },
      {
        pattern: "tests/**",
        description: "Integration tests",
        priority: "normal",
      },
      {
        pattern: "benches/**",
        description: "Criterion benchmarks",
        priority: "low",
      },
    ],
  };
}
