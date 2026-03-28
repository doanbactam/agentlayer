export interface TemplatePattern {
  glob: string
  classification: string
}

export interface TemplateRule {
  pattern: string
  description: string
  priority: "critical" | "high" | "normal" | "low"
}

export interface ContextTemplate {
  name: string
  description: string
  patterns: TemplatePattern[]
  rules: TemplateRule[]
}

/**
 * Each template has a "detection glob" — a single file pattern that, if found
 * in the project root, means this template is relevant. Used by --all auto-detect.
 */
export interface TemplateDetection {
  name: string
  detectGlob: string
}
