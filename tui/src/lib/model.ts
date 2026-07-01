// lib/model.ts — local model launch arguments.
// Builds the arg arrays for llamafile. Spawning is done by the caller
// (startDaemon for the local OpenAI-compatible server).

import { existsSync } from "fs";
import { capture } from "./exec.ts";
import {
  GGUF_DEST,
  GGUF_MIN_BYTES,
  GGUF_MMPROJ,
  LLAMAFILE_DEST,
  MODEL_SERVER_URL,
} from "./constants.ts";
import { statSync } from "fs";
import { fileExecutable } from "./exec.ts";

const CTX_SIZE = process.env.CTX_SIZE ?? "4096";
const PORT = process.env.PORT ?? "8080";

export { LLAMAFILE_DEST };

export function modelReady(): { runtime: boolean; weights: boolean } {
  const runtime = fileExecutable(LLAMAFILE_DEST);
  let weights = false;
  if (existsSync(GGUF_DEST)) {
    try { weights = statSync(GGUF_DEST).size >= GGUF_MIN_BYTES; } catch { /* ignore */ }
  }
  return { runtime, weights };
}

export function modelRunning(): boolean {
  try {
    // Quick sync check against the API endpoint
    const res = capture("curl", ["-fsS", MODEL_SERVER_URL]);
    return Boolean(res);
  } catch { return false; }
}

function baseModelArgs(): string[] {
  const args = [
    "-m", GGUF_DEST,
    "--ctx-size", CTX_SIZE,
    "--cache-type-k", "q4_0",
    "--cache-type-v", "q4_0",
    "--reasoning", "off",
    "--reasoning-budget", "0",
  ];
  if (existsSync(GGUF_MMPROJ)) args.push("--mmproj", GGUF_MMPROJ);
  return args;
}

/** Args for `llamafile --server` (background daemon). */
export function serverArgs(): string[] {
  return ["--server", ...baseModelArgs(), "--host", "127.0.0.1", "--port", PORT];
}
