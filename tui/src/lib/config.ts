// lib/config.ts — read/write .toolkit/config.json.
// Reads local config first, then tracked defaults, then legacy defaults.

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
  | "voiceInput";

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
];

function configSource(): string | null {
  if (existsSync(CONFIG_FILE)) return CONFIG_FILE;
  if (existsSync(DEFAULT_CONFIG_FILE)) return DEFAULT_CONFIG_FILE;
  if (existsSync(LEGACY_DEFAULT_CONFIG_FILE)) return LEGACY_DEFAULT_CONFIG_FILE;
  return null;
}

export function readConfig(): ToolkitConfig {
  const src = configSource();
  const empty: ToolkitConfig = {
    version: 1,
    addons: Object.fromEntries(ALL_ADDONS.map((k) => [k, false])) as Record<AddonKey, boolean>,
  };
  if (!src) return empty;
  try {
    const parsed = JSON.parse(readFileSync(src, "utf8"));
    const addons = { ...empty.addons };
    for (const k of ALL_ADDONS) {
      if (parsed?.addons?.[k] === true) addons[k] = true;
    }
    return { version: parsed.version ?? 1, addons };
  } catch {
    return empty;
  }
}

export function addonEnabled(key: AddonKey): boolean {
  return readConfig().addons[key] === true;
}

export function writeConfig(addons: Record<AddonKey, boolean>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const config: ToolkitConfig = { version: 1, addons };
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}
