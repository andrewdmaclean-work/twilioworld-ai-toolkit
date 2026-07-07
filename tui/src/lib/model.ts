// lib/model.ts — local model launch arguments.
// Builds the arg arrays for llamafile. Spawning is done by the caller
// (startDaemon for the local OpenAI-compatible server).

import { existsSync } from "fs";
import { capture } from "./exec.ts";
import { writeWebUiConfig } from "./webui-config.ts";
import {
  GGUF_DEST,
  GGUF_MIN_BYTES,
  GGUF_MMPROJ,
  LLAMAFILE_DEST,
  MODEL_SERVER_URL,
  WEBUI_CONFIG_FILE,
} from "./constants.ts";
import { statSync } from "fs";
import { fileExecutable } from "./exec.ts";

// Security audit E-11: 4096 was too small — the 56-skill system prompt plus
// tool-call scaffolding filled it within 2-3 turns ("ran out of context
// window"). 16384 gave real headroom, and was later doubled to 32768 for
// longer multi-tool sessions (more Skills lookups, longer tool results)
// without running out mid-conversation. Override with CTX_SIZE if needed.
// Validated to digits only — a malformed value falls back to the default
// instead of being passed through to the llamafile arg list unchecked.
function validDigits(raw: string | undefined, fallback: string): string {
  return raw && /^[0-9]+$/.test(raw) ? raw : fallback;
}

const CTX_SIZE = validDigits(process.env.CTX_SIZE, "32768");
const PORT = validDigits(process.env.PORT, "8080");

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
    // Reasoning enabled: Pi (and the in-TUI chat) can think before answering.
    // 'auto' lets the model's chat template decide; -1 budget = unrestricted.
    // The in-TUI chat strips <think> blocks from its rendered output, so it
    // stays terse for the user while still letting the model reason.
    "--reasoning", "auto",
    "--reasoning-budget", "-1",
  ];
  if (existsSync(GGUF_MMPROJ)) args.push("--mmproj", GGUF_MMPROJ);
  return args;
}

/** Args for `llamafile --server` (background daemon). */
export function serverArgs(): string[] {
  const args = ["--server", ...baseModelArgs(), "--host", "127.0.0.1", "--port", PORT];
  // Always seed the web UI's default settings server-side: Twilio Docs MCP
  // server (via the local HTTP→HTTPS bridge) + a Twilio-aware system
  // message. llamafile's built-in mechanism — no localStorage injection.
  writeWebUiConfig();
  args.push("--ui-config-file", WEBUI_CONFIG_FILE);
  // CORS proxy for MCP. Upstream warning: "do not enable in untrusted
  // environments." Only binds to 127.0.0.1, so exposure is local-only.
  args.push("--ui-mcp-proxy");
  return args;
}
