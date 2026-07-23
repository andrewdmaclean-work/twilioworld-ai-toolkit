// lib/pi.ts — Pi launch logic.
// Installs Pi capabilities (MCP, models, skills) then opens Pi in a
// brand-new terminal window, fully detached from the TUI. The dashboard
// keeps running normally — no suspend/resume needed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { capture, fileExecutable, have, openInNewWindow, runStreaming, startDaemon, type LogFn, type NewWindowResult } from "./exec.ts";
import { addonEnabled } from "./config.ts";
import {
  LLAMAFILE_DEST,
  MODEL_SERVER_BASE_URL,
  MODEL_SERVER_LOG,
  MODEL_SERVER_PID,
  MODEL_SERVER_PORT,
  MODEL_SERVER_URL,
  PI_AGENT_DIR,
  PI_MODELS_JSON,
  PI_ROUTING_PROMPT,
  ROOT,
  SKILLS_DIR,
} from "./constants.ts";
import { getSelectedModel } from "./local-models.ts";
import { writePiMcpConfig } from "./pi-mcp.ts";
import { modelStartupStatus, serverArgs, waitForModelServer } from "./model.ts";
import { statSync } from "fs";
import { pathNodeVersion, supportsPiNode } from "./node-version.ts";

function localModelReady(): boolean {
  const model = getSelectedModel();
  if (!existsSync(model.dest)) return false;
  try { if (statSync(model.dest).size < model.minBytes) return false; } catch { return false; }
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

function writePiModelsConfig(piDir: string): void {
  const raw = readFileSync(PI_MODELS_JSON, "utf8");
  const config = JSON.parse(raw) as {
    providers?: Record<string, { baseUrl?: string } & Record<string, unknown>>;
  };
  const providers = config.providers ?? {};
  const llamafile = providers.llamafile ?? {};
  llamafile.baseUrl = `${MODEL_SERVER_BASE_URL}/v1`;
  providers.llamafile = llamafile;
  config.providers = providers;
  writeFileSync(join(piDir, "models.json"), `${JSON.stringify(config, null, 2)}\n`);
}

export type PiReadiness =
  | { ok: false; reason: string }
  | { ok: true };

export function checkPiReadiness(): PiReadiness {
  if (!localGemmaAvailable()) return { ok: false, reason: "Local Gemma model not available. Run Setup to download it." };
  if (!nodeSupportsPi()) return { ok: false, reason: `Pi requires project-local Node >= 22.19.0 — node is ${piNodeVersionLabel()}. Re-run ./toolkit to repair .toolkit/toolchains/node-v22.` };
  if (!have("pi")) return { ok: false, reason: "Pi is not installed. Run Configure agent." };
  return { ok: true };
}

/** Install Pi capabilities then open Pi in a new terminal window.
 *  Returns once the window has been launched (or failed to launch) —
 *  does not wait for Pi itself to exit. */
export async function launchPi(opts: { onLog: LogFn; mcpCreds?: string }): Promise<NewWindowResult> {
  const { onLog, mcpCreds = "" } = opts;
  const effectiveMcpCreds = mcpCreds || process.env.TWILIO_MCP_CREDS || "";
  const readiness = checkPiReadiness();
  if (!readiness.ok) {
    onLog(`✗ ${readiness.reason}`, "stderr");
    return { ok: false, error: readiness.reason };
  }

  const piDir = PI_AGENT_DIR;
  mkdirSync(join(piDir, "skills"), { recursive: true });

  // Model config
  if (localGemmaAvailable() && existsSync(PI_MODELS_JSON)) {
    writePiModelsConfig(piDir);
  }

  // MCP adapter + config — Docs MCP always, Execute MCP if creds exist.
  await runStreaming("pi", ["install", "npm:pi-mcp-adapter"], {
    cwd: ROOT,
    env: { ...process.env, PI_CODING_AGENT_DIR: piDir },
    onLog,
  });
  writePiMcpConfig(piDir, effectiveMcpCreds);

  // Skills — always wired when the local Skills dir is present.
  if (existsSync(SKILLS_DIR)) {
    await runStreaming("cp", ["-r", join(SKILLS_DIR, "."), join(piDir, "skills")], { cwd: ROOT, onLog });
  }

  // Ensure model server is running
  if (!isModelServerRunning()) {
    onLog(`▶ Starting local Gemma service (${modelStartupStatus()})…`, "stdout");
    startDaemon(LLAMAFILE_DEST, serverArgs(), { cwd: ROOT, logFile: MODEL_SERVER_LOG, pidFile: MODEL_SERVER_PID });
    const ready = await waitForModelServer({
      timeoutSeconds: 90,
      onTick: (elapsed, status) => {
        if (elapsed === 1 || elapsed % 10 === 0) {
          onLog(`   Loading Gemma service… ${elapsed}s elapsed (${status})`, "stdout");
        }
      },
    });
    if (!ready) {
      onLog(`✗ Gemma service did not respond after 90s. Logs: ${MODEL_SERVER_LOG}`, "stderr");
      return { ok: false, error: `Gemma service did not respond after 90s. See ${MODEL_SERVER_LOG}` };
    } else {
      onLog(`✓ Gemma service ready on :${MODEL_SERVER_PORT}`, "stdout");
    }
  }

  const piArgs = [
    "--provider", "llamafile",
    "--model", "gemma4-e2b",
    "--thinking", "low",
    "--append-system-prompt", PI_ROUTING_PROMPT,
    "--no-skills",
  ];
  if (existsSync(join(piDir, "skills"))) {
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
