import type { ContextEntry } from "../types/index.js";

const SCORE_WEIGHTS = {
  path: 3,
  pattern: 2,
  description: 1,
  classification: 0.5,
} as const;
const MAX_RESULTS = 10;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "in",
  "on",
  "for",
  "to",
  "with",
  "and",
  "or",
  "of",
  "is",
  "at",
  "by",
  "from",
  "it",
  "as",
  "be",
  "was",
  "are",
]);

const tokenize = (input: string): string[] =>
  input
    .toLowerCase()
    .split(/[^a-z0-9_.\-/]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));

const match = (tokens: string[], text: string): number => {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    if (lower.includes(t)) hits++;
  }
  return hits;
};

export function route(query: string, entries: ContextEntry[]): ContextEntry[] {
  const tokens = tokenize(query);

  if (tokens.length === 0) return entries;

  const scored = entries.map((entry) => {
    let score = 0;

    score += match(tokens, entry.path) * SCORE_WEIGHTS.path;

    for (const rule of entry.rules) {
      score += match(tokens, rule.pattern) * SCORE_WEIGHTS.pattern;
      score += match(tokens, rule.description) * SCORE_WEIGHTS.description;
    }

    for (const ann of entry.annotations) {
      score += match(tokens, ann.text) * SCORE_WEIGHTS.description;
    }

    score += match(tokens, entry.classification) * SCORE_WEIGHTS.classification;

    return { entry, score };
  });

  const hits = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((s) => s.entry);

  return hits.length > 0 ? hits : entries;
}
