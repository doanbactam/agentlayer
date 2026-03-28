export { cursor } from "./cursor.js"
export { windsurf } from "./windsurf.js"
export type { Adapter, AdapterContext, AdapterOutput } from "./types.js"
export { SYNC_MARKER_START, SYNC_MARKER_END } from "./types.js"

import { cursor } from "./cursor.js"
import { windsurf } from "./windsurf.js"
import type { Adapter } from "./types.js"

export const adapters: Record<string, Adapter> = {
  cursor,
  windsurf,
}

export function getAdapter(name: string): Adapter | undefined {
  return adapters[name.toLowerCase()]
}

export function getAdapterNames(): string[] {
  return Object.keys(adapters)
}
