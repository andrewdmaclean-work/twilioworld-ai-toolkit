// lib/constants.ts — pinned versions, URLs, and shared paths.

import { join } from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";

const TUI_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // tui/
export const ROOT = dirname(TUI_DIR); // repo root

// ── Pinned versions ─────────────────────────────────────────────────
export const LLAMAFILE_VERSION = "0.10.3";
export const TWILIO_MCP_PKG = "@twilio-alpha/mcp@0.6.0";
export const DOCS_MCP_URL = "https://mcp.twilio.com/docs";

// Security audit L-1: this was previously installed unversioned
// (`npm install -g @earendil-works/pi-coding-agent`), exposing Setup to
// unannounced upstream breaking changes or a compromised "latest" tag.
// Pinned to a version confirmed to work with this toolkit's Pi wiring.
export const PI_AGENT_PKG = "@earendil-works/pi-coding-agent@0.80.3";

// llamafile ships as a cosmopolitan/APE binary; setup.ts checks the "MZ"
// magic bytes structurally (see looksLikeExecutable) rather than trusting
// the download blindly. TODO(security C-1): pin a real SHA-256 once one
// is published/verified per platform for LLAMAFILE_VERSION, and check it
// here before chmod +x — the magic-byte check alone catches corrupted/
// captive-portal responses but not a byte-for-byte trojanized binary
// with a still-valid APE header.
export const LLAMAFILE_SHA256: string | null = null;

// Official Google Gemma 4 E2B GGUF from Kaggle — no API key required.
export const GGUF_URL =
  "https://www.kaggle.com/api/v1/models/google/gemma-4/gguf/gemma-4-e2b-it-qat-q4_0-gguf/2/download";

// ── Paths ────────────────────────────────────────────────────────────
export const CONFIG_DIR = join(ROOT, ".toolkit");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const DEFAULT_CONFIG_FILE = join(ROOT, "toolkit.defaults.json");
export const LEGACY_DEFAULT_CONFIG_FILE = join(CONFIG_DIR, "defaults.json");

export const PI_AGENT_DIR = join(CONFIG_DIR, "pi-agent");
export const PI_MODELS_JSON = join(ROOT, ".pi", "models.json");
export const PI_ROUTING_PROMPT = join(ROOT, ".pi", "routing-prompt.md");

export const MODELS_DIR = join(ROOT, "models");
export const TOOLS_DIR = join(ROOT, "tools");
export const GGUF_DEST = join(MODELS_DIR, "gemma4-e2b.gguf");
export const GGUF_MMPROJ = join(MODELS_DIR, "gemma4-e2b-mmproj.gguf");
export const GGUF_STAGING = join(MODELS_DIR, "gemma4-e2b.download");
export const SYSTEM_PROMPT = join(MODELS_DIR, "system-prompt.txt");
export const GGUF_MIN_BYTES = 1_500_000_000; // 1.5 GB floor for the main model

export const SKILLS_DIR = join(ROOT, "vendor", "twilio-ai", "skills");

// ── OS-specific llamafile ────────────────────────────────────────────
const isWindows = process.platform === "win32";
export const LLAMAFILE_URL = isWindows
  ? `https://github.com/mozilla-ai/llamafile/releases/download/${LLAMAFILE_VERSION}/llamafile-${LLAMAFILE_VERSION}.exe`
  : `https://github.com/mozilla-ai/llamafile/releases/download/${LLAMAFILE_VERSION}/llamafile-${LLAMAFILE_VERSION}`;
export const LLAMAFILE_DEST = join(TOOLS_DIR, isWindows ? "llamafile.exe" : "llamafile");
export const WHISPERFILE_URL =
  `https://github.com/mozilla-ai/llamafile/releases/download/${LLAMAFILE_VERSION}/whisperfile-${LLAMAFILE_VERSION}`;
export const WHISPERFILE_DEST = join(TOOLS_DIR, isWindows ? "whisperfile.exe" : "whisperfile");
export const WHISPER_MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin";
export const WHISPER_MODEL_DEST = join(MODELS_DIR, "whisper-tiny.en-q5_1.bin");
export const WHISPER_MODEL_STAGING = join(MODELS_DIR, "whisper-tiny.en-q5_1.download");
export const WHISPER_MODEL_MIN_BYTES = 20_000_000;
export const VOICE_TMP_DIR = join(MODELS_DIR, "voice");

export const MODEL_SERVER_URL = "http://127.0.0.1:8080/v1/models";
export const MODEL_SERVER_LOG = join(MODELS_DIR, "pi-server.log");
