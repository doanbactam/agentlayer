import type { ContextTemplate } from "./registry.js";

export function reactNativeTemplate(): ContextTemplate {
  return {
    name: "react-native",
    description: "React Native + Expo Router",
    patterns: [
      { glob: "app/**/_layout.tsx", classification: "source" },
      { glob: "app/**/+.ts", classification: "source" },
      { glob: "metro.config.js", classification: "config" },
      { glob: "eas.json", classification: "config" },
    ],
    rules: [
      {
        pattern: "app/**/_layout.tsx",
        description: "Expo Router layout",
        priority: "critical",
      },
      {
        pattern: "app/**/+.ts",
        description: "Dynamic route segment",
        priority: "high",
      },
      {
        pattern: "metro.config.js",
        description: "Metro bundler config",
        priority: "high",
      },
      {
        pattern: "eas.json",
        description: "EAS Build/Submit config",
        priority: "normal",
      },
    ],
  };
}
