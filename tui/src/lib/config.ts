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

export type ModelReasoningMode = "off" | "on" | "auto";

export interface ToolkitConfig {
  version: number;
  addons: Record<AddonKey, boolean>;
  settings: {
    modelReasoning: ModelReasoningMode;
    localModelSlug?: string;
  };
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

function validReasoningMode(value: unknown, fallback: ModelReasoningMode = "auto"): ModelReasoningMode {
  return value === "off" || value === "on" || value === "auto" ? value : fallback;
}

export function readConfig(): ToolkitConfig {
  const allFalse = Object.fromEntries(ALL_ADDONS.map((k) => [k, false])) as Record<AddonKey, boolean>;
  let modelReasoning: ModelReasoningMode = "auto";
  let localModelSlug: string | undefined;

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
        modelReasoning = validReasoningMode(d?.settings?.modelReasoning, modelReasoning);
        if (typeof d?.settings?.localModelSlug === "string") localModelSlug = d.settings.localModelSlug;
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
      modelReasoning = validReasoningMode(local?.settings?.modelReasoning, modelReasoning);
      if (typeof local?.settings?.localModelSlug === "string") localModelSlug = local.settings.localModelSlug;
      return { version: local.version ?? 1, addons: base, settings: { modelReasoning, localModelSlug } };
    } catch {
      return { version: 1, addons: base, settings: { modelReasoning, localModelSlug } };
    }
  }

  return { version: 1, addons: base, settings: { modelReasoning, localModelSlug } };
}

export function addonEnabled(key: AddonKey): boolean {
  return readConfig().addons[key] === true;
}

export function writeConfig(
  addons: Record<AddonKey, boolean>,
  settings: ToolkitConfig["settings"] = readConfig().settings,
): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const config: ToolkitConfig = { version: 1, addons, settings };
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function modelReasoningMode(): ModelReasoningMode {
  return readConfig().settings.modelReasoning;
}

export function setModelReasoningMode(mode: ModelReasoningMode): void {
  const config = readConfig();
  writeConfig(config.addons, { ...config.settings, modelReasoning: validReasoningMode(mode) });
}

export function setLocalModelSlug(slug: string): void {
  const config = readConfig();
  writeConfig(config.addons, { ...config.settings, localModelSlug: slug });
}
