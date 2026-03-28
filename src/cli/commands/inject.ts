import * as fs from "node:fs";
import * as path from "node:path";
import { ContextStore } from "../../store/index.js";
import { route } from "../../router/index.js";
import { formatContext } from "../utils.js";
import type { ContextEntry } from "../../types/index.js";

interface InjectOptions {
  file?: string;
}

export async function inject(
  query?: string,
  options?: InjectOptions,
): Promise<void> {
  const projectRoot = process.cwd();
  const storePath = path.join(projectRoot, ".agentmind", "context.db");

  if (!fs.existsSync(storePath)) {
    process.exit(0);
  }

  const store = new ContextStore(projectRoot);

  try {
    if (options?.file) {
      const entries = store.queryContext({ filePath: options.file });

      if (entries.length === 0) {
        process.exit(0);
      }

      console.log(formatContext(entries));
      return;
    }

    if (query) {
      const allEntries = store.getEntries();
      let relevant: ContextEntry[];
      try {
        relevant = route(query, allEntries);
      } catch {
        relevant = allEntries;
      }

      if (relevant.length === 0) {
        process.exit(0);
      }

      console.log(formatContext(relevant));
      return;
    }

    process.exit(0);
  } finally {
    store.close();
  }
}
