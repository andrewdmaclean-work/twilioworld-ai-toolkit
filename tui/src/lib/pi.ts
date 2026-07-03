// lib/pi.ts — Pi launch logic.
// Installs Pi capabilities (MCP, models, skills) then opens Pi in a
// brand-new terminal window, fully detached from the TUI. The dashboard
// keeps running normally — no suspend/resume needed.

import { copyFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { capture, fileExecutable, have, openInNewWindow, runStreaming, startDaemon, type LogFn, type NewWindowResult } from "./exec.ts";
import { addonEnabled } from "./config.ts";
import {
  GGUF_DEST,
  GGUF_MIN_BYTES,
  LLAMAFILE_DEST,
  MODEL_SERVER_URL,
  PI_AGENT_DIR,
  PI_MODELS_JSON,
  PI_ROUTING_PROMPT,
  ROOT,
  SKILLS_DIR,
} from "./constants.ts";
import { writePiMcpConfig } from "./pi-mcp.ts";
import { serverArgs } from "./model.ts";
import { statSync } from "fs";
import { pathNodeVersion, supportsPiNode } from "./node-version.ts";

function localModelReady(): boolean {
  if (!existsSync(GGUF_DEST)) return false;
  try { if (statSync(GGUF_DEST).size < GGUF_MIN_BYTES) return false; } catch { return false; }
  return fileExecutable(LLAMAFILE_DEST);
}

export function localGemmaAvailable(): boolean {
  return addonEnabled("localGemma") || localModelReady();
}

export function nodeSupportsPi(): boolean {
  return supportsPiNode(pathNodeVersion());
}

export function piNodeVersionLabel(): string {
  return pathNodeVersion()?.raw ?? "not found";
}

export function isModelServerRunning(): boolean {
  try { return Boolean(capture("curl", ["-fsS", MODEL_SERVER_URL])); } catch { return false; }
}

export type PiReadiness =
  | { ok: false; reason: string }
  | { ok: true };

export function checkPiReadiness(): PiReadiness {
  if (!localGemmaAvailable()) return { ok: false, reason: "Local Gemma model not available. Run Setup to download it." };
  if (!nodeSupportsPi()) return { ok: false, reason: `Pi requires Node >= 22.19.0 on PATH — node is ${piNodeVersionLabel()}. Run: nvm use 22` };
  if (!have("pi")) return { ok: false, reason: "Pi is not installed. Run Configure agent." };
  return { ok: true };
}

/** Install Pi capabilities then open Pi in a new terminal window.
 *  Returns once the window has been launched (or failed to launch) —
 *  does not wait for Pi itself to exit. */
export async function launchPi(opts: { onLog: LogFn }): Promise<NewWindowResult> {
  const { onLog } = opts;
  const readiness = checkPiReadiness();
  if (!readiness.ok) {
    onLog(`✗ ${readiness.reason}`, "stderr");
    return { ok: false, error: readiness.reason };
  }

  const piDir = PI_AGENT_DIR;
  mkdirSync(join(piDir, "skills"), { recursive: true });

  // Model config
  if (localGemmaAvailable() && existsSync(PI_MODELS_JSON)) {
    copyFileSync(PI_MODELS_JSON, join(piDir, "models.json"));
  }

  // MCP adapter + config
  if (addonEnabled("docsMcp") || addonEnabled("executeMcp")) {
    await runStreaming("pi", ["install", "npm:pi-mcp-adapter"], {
      cwd: ROOT,
      env: { ...process.env, PI_CODING_AGENT_DIR: piDir },
      onLog,
    });
    writePiMcpConfig(piDir);
  }

  // Skills
  if (addonEnabled("twilioSkills") && existsSync(SKILLS_DIR)) {
    await runStreaming("cp", ["-r", join(SKILLS_DIR, "."), join(piDir, "skills")], { cwd: ROOT, onLog });
  } else if (!addonEnabled("twilioSkills") && existsSync(join(piDir, "skills"))) {
    // Clear stale skills if add-on was disabled
    rmSync(join(piDir, "skills"), { recursive: true, force: true });
    mkdirSync(join(piDir, "skills"));
  }

  // Ensure model server is running
  if (!isModelServerRunning()) {
    onLog("▶ Starting local Gemma service…", "stdout");
    startDaemon(LLAMAFILE_DEST, serverArgs(), { cwd: ROOT });
    // Give it a few seconds to start
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));
    if (!isModelServerRunning()) {
      onLog("⚠  Gemma service did not respond yet — Pi may be slow to start.", "stderr");
    } else {
      onLog("✓ Gemma service ready on :8080", "stdout");
    }
  }

  const piArgs = [
    "--provider", "llamafile",
    "--model", "gemma4-e2b",
    "--append-system-prompt", PI_ROUTING_PROMPT,
    "--no-skills",
  ];
  if (addonEnabled("twilioSkills")) {
    piArgs.push("--skill", join(piDir, "skills"));
  }

  const result = openInNewWindow("pi", piArgs, {
    cwd: ROOT,
    env: { ...process.env, PI_CODING_AGENT_DIR: piDir },
  });
  if (result.ok) {
    onLog("✓ Pi opened in a new terminal window", "stdout");
  } else {
    onLog(`✗ ${result.error}`, "stderr");
  }
  return result;
}
