// lib/uninstall.ts — non-interactive uninstall actions selected from the TUI.

import { existsSync, readdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { capture, have, runStreaming, type LogFn } from "./exec.ts";
import {
  CONFIG_FILE,
  CONFIG_DIR,
  GGUF_DEST,
  GGUF_MMPROJ,
  GGUF_STAGING,
  LLAMAFILE_DEST,
  MODEL_SERVER_LOG,
  MODELS_DIR,
  ROOT,
  SKILLS_DIR,
  TOOLS_DIR,
  WHISPERFILE_DEST,
  WHISPER_MODEL_DEST,
  WHISPER_MODEL_STAGING,
} from "./constants.ts";

export type UninstallKey =
  | "devPhone"
  | "apiKey"
  | "twilioCli"
  | "skills"
  | "repoSkills"
  | "toolkitState"
  | "modelRuntime";

function ok(msg: string, onLog: LogFn) { onLog(`✓ ${msg}`, "stdout"); }
function warn(msg: string, onLog: LogFn) { onLog(`⚠  ${msg}`, "stderr"); }
function err(msg: string, onLog: LogFn) { onLog(`✗ ${msg}`, "stderr"); }
function step(msg: string, onLog: LogFn) { onLog(`\n▶ ${msg}`, "stdout"); }

function rmPath(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { recursive: true, force: true });
  return true;
}

function removeExtractDirs(): number {
  if (!existsSync(MODELS_DIR)) return 0;
  let removed = 0;
  for (const entry of readdirSync(MODELS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("extract-")) continue;
    rmSync(join(MODELS_DIR, entry.name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

function toolkitKeySid(): string {
  if (!have("twilio")) return "";
  try {
    const raw = capture("twilio", ["api:core:keys:list", "-o", "json"]);
    const keys: Array<{ friendlyName?: string; sid?: string }> = JSON.parse(raw || "[]");
    return keys.find((key) => key.friendlyName === "twilioworld-toolkit")?.sid ?? "";
  } catch {
    return "";
  }
}

async function removeDevPhone(onLog: LogFn): Promise<boolean> {
  step("Dev Phone plugin", onLog);
  if (!have("twilio")) {
    warn("Twilio CLI not found; Dev Phone plugin is not removable from here.", onLog);
    return true;
  }
  const plugins = capture("twilio", ["plugins"]);
  if (!plugins.includes("plugin-dev-phone")) {
    ok("Dev Phone plugin not installed.", onLog);
    return true;
  }
  const res = await runStreaming("twilio", ["plugins:remove", "@twilio-labs/plugin-dev-phone"], { cwd: ROOT, onLog });
  if (res.ok) ok("Dev Phone plugin removed.", onLog);
  else err("Dev Phone plugin removal failed.", onLog);
  return res.ok;
}

async function removeApiKey(onLog: LogFn): Promise<boolean> {
  step("Toolkit API key", onLog);
  if (!have("twilio")) {
    warn("Twilio CLI not found; API key was not checked.", onLog);
    return true;
  }
  const sid = toolkitKeySid();
  if (!sid) {
    ok("No API key named twilioworld-toolkit found.", onLog);
    return true;
  }
  const res = await runStreaming("twilio", ["api:core:keys:remove", "--sid", sid], { cwd: ROOT, onLog });
  if (res.ok) ok(`API key ${sid} deleted.`, onLog);
  else err(`Could not delete API key ${sid}.`, onLog);
  return res.ok;
}

async function removeTwilioCli(onLog: LogFn): Promise<boolean> {
  step("Twilio CLI", onLog);
  if (!have("twilio")) {
    ok("Twilio CLI not installed.", onLog);
    return true;
  }
  if (!have("npm")) {
    warn("npm not found; remove Twilio CLI manually if needed.", onLog);
    return false;
  }
  const res = await runStreaming("npm", ["uninstall", "-g", "twilio-cli"], { cwd: ROOT, onLog });
  if (res.ok) ok("Twilio CLI removed.", onLog);
  else err("Twilio CLI removal failed.", onLog);
  return res.ok;
}

function removeSkills(onLog: LogFn): boolean {
  step("Twilio Skills installed for agents", onLog);
  const skillsDir = join(homedir(), ".agents", "skills");
  const removed = [
    rmPath(join(skillsDir, "twilio")),
    rmPath(join(skillsDir, "sendgrid")),
  ].filter(Boolean).length;
  if (removed) ok("Removed twilio/ and sendgrid/ from ~/.agents/skills/.", onLog);
  else ok("No Twilio/SendGrid skills found under ~/.agents/skills/.", onLog);
  return true;
}

function removeRepoSkills(onLog: LogFn): boolean {
  step("Local toolkit copy of Twilio Skills", onLog);
  if (rmPath(SKILLS_DIR)) {
    ok("Removed the local toolkit copy of Twilio Skills. Run Setup to download it again.", onLog);
  } else {
    ok("No local toolkit copy of Twilio Skills found.", onLog);
  }
  return true;
}

function removeToolkitState(onLog: LogFn): boolean {
  step("Local toolkit state", onLog);
  const removed = [
    rmPath(CONFIG_FILE),
    rmPath(join(CONFIG_DIR, ".env")),
    rmPath(join(CONFIG_DIR, "pi-agent")),
  ].filter(Boolean).length;
  if (removed) ok("Removed .toolkit config, creds file, and/or Pi state.", onLog);
  else ok("No local .toolkit state found.", onLog);
  return true;
}

function removeModelRuntime(onLog: LogFn): boolean {
  step("Local model and runtimes", onLog);
  const paths = [
    GGUF_DEST,
    GGUF_MMPROJ,
    GGUF_STAGING,
    WHISPER_MODEL_DEST,
    WHISPER_MODEL_STAGING,
    MODEL_SERVER_LOG,
    LLAMAFILE_DEST,
    WHISPERFILE_DEST,
    join(TOOLS_DIR, "llamafile.exe"),
    join(TOOLS_DIR, "whisperfile.exe"),
    join(MODELS_DIR, "voice"),
    join(MODELS_DIR, "extract_tmp"),
  ];
  const removed = paths.map(rmPath).filter(Boolean).length + removeExtractDirs();
  if (removed) ok(`Removed ${removed} local model/runtime path(s).`, onLog);
  else ok("No downloaded model/runtime files found.", onLog);
  return true;
}

export async function runUninstall(opts: {
  keys: UninstallKey[];
  onLog: LogFn;
  onDone: (ok: boolean) => void;
}): Promise<void> {
  const { keys, onLog, onDone } = opts;
  if (!keys.length) {
    warn("No uninstall items selected.", onLog);
    onDone(true);
    return;
  }

  let allOk = true;
  for (const key of keys) {
    try {
      if (key === "devPhone") allOk = (await removeDevPhone(onLog)) && allOk;
      else if (key === "apiKey") allOk = (await removeApiKey(onLog)) && allOk;
      else if (key === "twilioCli") allOk = (await removeTwilioCli(onLog)) && allOk;
      else if (key === "skills") allOk = removeSkills(onLog) && allOk;
      else if (key === "repoSkills") allOk = removeRepoSkills(onLog) && allOk;
      else if (key === "toolkitState") allOk = removeToolkitState(onLog) && allOk;
      else if (key === "modelRuntime") allOk = removeModelRuntime(onLog) && allOk;
    } catch (e) {
      err((e as Error).message, onLog);
      allOk = false;
    }
  }

  onLog("", "stdout");
  ok("Uninstall flow complete. Twilio CLI profile is still signed in unless you run `twilio logout`.", onLog);
  onDone(allOk);
}
