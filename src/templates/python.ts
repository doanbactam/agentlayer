import type { ContextTemplate } from "./registry.js";

export function pythonTemplate(): ContextTemplate {
  return {
    name: "python",
    description: "Python — standard project layout with pyproject.toml",
    patterns: [
      { glob: "pyproject.toml", classification: "config" },
      { glob: "src/**/*.py", classification: "source" },
      { glob: "tests/**/*.py", classification: "test" },
      { glob: "requirements.txt", classification: "config" },
      { glob: "Pipfile", classification: "config" },
    ],
    rules: [
      {
        pattern: "pyproject.toml",
        description: "Python project config (PEP 621)",
        priority: "critical",
      },
      {
        pattern: "src/**/*.py",
        description: "Source package layout",
        priority: "high",
      },
      {
        pattern: "tests/**/*.py",
        description: "Pytest tests",
        priority: "normal",
      },
      {
        pattern: "requirements.txt",
        description: "Dependency file",
        priority: "high",
      },
      {
        pattern: "Pipfile",
        description: "Dependency file",
        priority: "high",
      },
    ],
  };
}
