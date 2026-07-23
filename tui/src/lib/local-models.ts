// lib/local-models.ts — local model catalog and selection helpers.

import { existsSync, statSync } from "fs";
import { join } from "path";
import { MODELS_DIR } from "./constants.ts";
import { readConfig } from "./config.ts";
import { fileExecutable } from "./exec.ts";
import { LLAMAFILE_DEST } from "./constants.ts";

export interface LocalModel {
  slug: string;
  name: string;
  description: string;
  // Content-addressed Ollama blob URL — immutable by SHA-256 digest.
  url: string;
  sizeBytes: number;
  sizeLabel: string;
  minBytes: number;
  dest: string;
  staging: string;
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    slug: "gemma4-e2b",
    name: "Gemma 4 E2B",
    description: "Google · multimodal · ~3.3 GB",
    url: "https://registry.ollama.ai/v2/library/gemma4/blobs/sha256:3646b4c147cd235a44d91df1546d3b7d8e29b547dbe4e1f80856419aa455e6fd",
    sizeBytes: 3_349_514_112,
    sizeLabel: "3.3 GB",
    minBytes: 1_500_000_000,
    dest: join(MODELS_DIR, "gemma4-e2b.gguf"),
    staging: join(MODELS_DIR, "gemma4-e2b.download"),
  },
  {
    slug: "phi4-mini",
    name: "Phi-4-mini",
    description: "Microsoft · reasoning + code · ~2.5 GB",
    url: "https://registry.ollama.ai/v2/library/phi4-mini/blobs/sha256:3c168af1dea0a414299c7d9077e100ac763370e5a98b3c53801a958a47f0a5db",
    sizeBytes: 2_491_874_624,
    sizeLabel: "2.5 GB",
    minBytes: 1_500_000_000,
    dest: join(MODELS_DIR, "phi4-mini.gguf"),
    staging: join(MODELS_DIR, "phi4-mini.download"),
  },
];

export const DEFAULT_MODEL_SLUG = "gemma4-e2b";

export function getModel(slug: string): LocalModel {
  const m = LOCAL_MODELS.find((m) => m.slug === slug);
  if (!m) throw new Error(`Unknown model slug: ${slug}`);
  return m;
}

export function getSelectedModel(): LocalModel {
  const cfg = readConfig();
  const slug = cfg.settings.localModelSlug ?? DEFAULT_MODEL_SLUG;
  return LOCAL_MODELS.find((m) => m.slug === slug) ?? LOCAL_MODELS[0];
}

export function localModelInstalled(model: LocalModel): boolean {
  if (!fileExecutable(LLAMAFILE_DEST)) return false;
  if (!existsSync(model.dest)) return false;
  try { return statSync(model.dest).size >= model.minBytes; } catch { return false; }
}
