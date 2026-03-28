import type { ContextTemplate } from "./registry.js"

export function nextjsTemplate(): ContextTemplate {
  return {
    name: "nextjs",
    description: "Next.js App Router + TypeScript",
    patterns: [
      { glob: "next.config.*", classification: "config" },
      { glob: "app/**/layout.tsx", classification: "source" },
      { glob: "app/**/page.tsx", classification: "source" },
      { glob: "app/**/loading.tsx", classification: "source" },
      { glob: "app/**/error.tsx", classification: "source" },
      { glob: "middleware.ts", classification: "source" },
      { glob: ".env.local", classification: "config" },
    ],
    rules: [
      {
        pattern: "next.config.*",
        description: "Next.js config — custom webpack/turbopack settings",
        priority: "high",
      },
      {
        pattern: "app/**/layout.tsx",
        description: "App Router layout — wraps all child routes",
        priority: "critical",
      },
      {
        pattern: "app/**/page.tsx",
        description: "Page component — server component by default, add 'use client' for client components",
        priority: "critical",
      },
      {
        pattern: "app/**/loading.tsx",
        description: "Suspense boundary for route",
        priority: "normal",
      },
      {
        pattern: "app/**/error.tsx",
        description: "Error boundary for route — must be a client component",
        priority: "normal",
      },
      {
        pattern: "middleware.ts",
        description: "Edge middleware — runs on every request, no Node.js APIs",
        priority: "high",
      },
      {
        pattern: ".env.local",
        description: "Environment variables — never commit to git",
        priority: "critical",
      },
    ],
  }
}
