// lib/model.ts — local model launch arguments.
// Builds the arg arrays for llamafile. Spawning is done by the caller
// (startDaemon for the local OpenAI-compatible server).

import { existsSync, readFileSync } from "fs";
import { capture } from "./exec.ts";
import { modelReasoningMode, type ModelReasoningMode } from "./config.ts";
import { writeWebUiConfig } from "./webui-config.ts";
import {
  GGUF_DEST,
  GGUF_MIN_BYTES,
  GGUF_MMPROJ,
  LLAMAFILE_DEST,
  MODEL_SERVER_BASE_URL,
  MODEL_SERVER_LOG,
  MODEL_SERVER_PORT,
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

function validReasoning(raw: string | undefined): ModelReasoningMode | null {
  if (raw === "off") return "off";
  return raw === "on" || raw === "auto" ? raw : "off";
}

export const MODEL_CTX_SIZE = validDigits(process.env.CTX_SIZE, "32768");
export const MODEL_REASONING = process.env.MODEL_REASONING
  ? validReasoning(process.env.MODEL_REASONING) ?? "off"
  : modelReasoningMode();
const PORT = MODEL_SERVER_PORT;

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
    const res = capture("curl", ["-fsS", "--max-time", "1", MODEL_SERVER_URL]);
    return Boolean(res);
  } catch { return false; }
}

export { MODEL_SERVER_LOG };

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function modelStartupStatus(): string {
  if (!existsSync(MODEL_SERVER_LOG)) return "starting process";
  try {
    const lines = readFileSync(MODEL_SERVER_LOG, "utf8").split(/\r?\n/).slice(-120);
    const text = lines.join("\n");
    if (/Segmentation fault/.test(text)) return "crashed: segmentation fault";
    if (/failed to initialize|failed to create llama_context|error while trying/.test(text)) return "failed during model initialization";
    if (/server is listening/.test(text)) return "server listening";
    if (/warming up the model/.test(text)) return "warming up model";
    if (/loading model/.test(text)) return "loading model weights";
    if (/binding port/.test(text)) return `binding port ${MODEL_SERVER_PORT}`;
    return "starting process";
  } catch {
    return "reading startup log";
  }
}

export async function waitForModelServer(opts: {
  timeoutSeconds?: number;
  onTick?: (elapsedSeconds: number, status: string) => void;
} = {}): Promise<boolean> {
  const timeoutSeconds = opts.timeoutSeconds ?? 90;
  for (let i = 0; i < timeoutSeconds; i++) {
    if (modelRunning()) return true;
    opts.onTick?.(i + 1, modelStartupStatus());
    await sleep(1000);
  }
  return modelRunning();
}

function baseModelArgs(): string[] {
  const args = [
    "-m", GGUF_DEST,
    "--ctx-size", MODEL_CTX_SIZE,
    "--parallel", "1",
    "--flash-attn", "on",
    "--cache-type-k", "q4_0",
    "--cache-type-v", "q4_0",
    // Disable thinking by default. On Pi-class CPUs reasoning can spend a long
    // time in <think> before producing a useful answer. Override per run with
    // MODEL_REASONING=on or MODEL_REASONING=auto.
    "--reasoning", MODEL_REASONING,
  ];
  if (existsSync(GGUF_MMPROJ)) args.push("--mmproj", GGUF_MMPROJ);
  return args;
}

export function modelEndpointLabel(): string {
  return `${MODEL_SERVER_BASE_URL}/v1`;
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
