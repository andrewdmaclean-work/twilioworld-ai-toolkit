// lib/config.ts — read/write .toolkit/config.json.
// Reads defaults first, then overlays local config — so new addon keys
// added to toolkit.defaults.json are picked up even by users whose local
// config pre-dates them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_CONFIG_FILE,
  LEGACY_DEFAULT_CONFIG_FILE,
} from "./constants.ts";

export type AddonKey =
  | "twilioSkills"
  | "docsMcp"
  | "executeMcp"
  | "devPhone"
  | "localGemma"
  | "voiceInput"
  | "llamaUiMcp";

export interface ToolkitConfig {
  version: number;
  addons: Record<AddonKey, boolean>;
}

const ALL_ADDONS: AddonKey[] = [
  "twilioSkills",
  "docsMcp",
  "executeMcp",
  "devPhone",
  "localGemma",
  "voiceInput",
  "llamaUiMcp",
];

export function readConfig(): ToolkitConfig {
  const allFalse = Object.fromEntries(ALL_ADDONS.map((k) => [k, false])) as Record<AddonKey, boolean>;

  // Build base from tracked defaults (toolkit.defaults.json or legacy).
  // This means new addon keys added to defaults are visible to users whose
  // local config pre-dates them — without it, a key absent from an old
  // config.json is silently treated as false even when the default is true.
  const base = { ...allFalse };
  for (const src of [DEFAULT_CONFIG_FILE, LEGACY_DEFAULT_CONFIG_FILE]) {
    if (existsSync(src)) {
      try {
        const d = JSON.parse(readFileSync(src, "utf8"));
        for (const k of ALL_ADDONS) {
          if (d?.addons?.[k] === true) base[k] = true;
        }
      } catch { /* ignore */ }
      break;
    }
  }

  // Overlay with local config — only for keys explicitly present there
  // (boolean true or false). Keys absent from local config keep the
  // default value built above.
  if (existsSync(CONFIG_FILE)) {
    try {
      const local = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
      for (const k of ALL_ADDONS) {
        if (typeof local?.addons?.[k] === "boolean") base[k] = local.addons[k];
      }
      return { version: local.version ?? 1, addons: base };
    } catch {
      return { version: 1, addons: base };
    }
  }

  return { version: 1, addons: base };
}

export function addonEnabled(key: AddonKey): boolean {
  return readConfig().addons[key] === true;
}

export function writeConfig(addons: Record<AddonKey, boolean>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const config: ToolkitConfig = { version: 1, addons };
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}
