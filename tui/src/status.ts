// status.ts — compute live toolkit status natively in TypeScript.
// Uses the same lib modules the rest of the TUI uses so nothing can drift.
//
// IMPORTANT: every subprocess check here (twilio CLI, opencode, pi, curl,
// node --version) runs via the *Async primitives in exec.ts, and independent
// checks run concurrently with Promise.all. The Twilio CLI alone takes ~1s
// to boot per invocation (oclif startup cost) and we call it twice; done
// synchronously and sequentially that's ~2.7s of the whole TUI (rendering,
// keypresses, any in-flight chat fetch) being completely frozen on every
// 30s poll. Async + parallel keeps the event loop free the whole time, so
// nothing freezes even though the status update itself still takes ~1s.

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { captureAsync, fileExecutable, haveAsync } from "./lib/exec.ts";
import { readConfig } from "./lib/config.ts";
import {
  GGUF_DEST,
  GGUF_MIN_BYTES,
  LLAMAFILE_DEST,
  MODEL_SERVER_URL,
  ROOT,
  SKILLS_DIR,
  WHISPERFILE_DEST,
  WHISPER_MODEL_DEST,
  WHISPER_MODEL_MIN_BYTES,
} from "./lib/constants.ts";
import { pathNodeVersionAsync, supportsPiNode } from "./lib/node-version.ts";

export { ROOT };

export interface ToolkitStatus {
  twilio:   { installed: boolean; profile: string; sid: string };
  skills:   { count: number };
  model:    { fileReady: boolean; runtimeReady: boolean; ready: boolean; running: boolean };
  voice:    { runtimeReady: boolean; modelReady: boolean; recorder: string; ready: boolean };
  devPhone: { installed: boolean };
  opencode: { installed: boolean; version: string };
  pi:       { installed: boolean };
  node:     { version: string; supportsPi: boolean };
  localGemmaAvailable: boolean;
  addons:   Record<string, boolean>;
}

function ggufReady(): boolean {
  if (!existsSync(GGUF_DEST)) return false;
  try { return statSync(GGUF_DEST).size >= GGUF_MIN_BYTES; } catch { return false; }
}

function whisperModelReady(): boolean {
  if (!existsSync(WHISPER_MODEL_DEST)) return false;
  try { return statSync(WHISPER_MODEL_DEST).size >= WHISPER_MODEL_MIN_BYTES; } catch { return false; }
}

function countSkills(dir: string): number {
  let n = 0;
  if (!existsSync(dir)) return 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) n += countSkills(join(dir, entry.name));
      else if (entry.name === "SKILL.md") n++;
    }
  } catch { /* ignore */ }
  return n;
}

/** Fully async, fully parallel status read. Nothing here blocks the main
 *  thread — every subprocess check is spawned concurrently and awaited
 *  together, so OpenTUI keeps rendering/handling input the whole time. */
export async function readStatusAsync(): Promise<ToolkitStatus> {
  // fs-only checks are cheap and synchronous is fine for them.
  const fileReady = ggufReady();
  const runtimeReady = fileExecutable(LLAMAFILE_DEST);
  const whisperRuntimeReady = fileExecutable(WHISPERFILE_DEST);
  const whisperReady = whisperModelReady();
  const skillCount = countSkills(SKILLS_DIR);
  const cfg = readConfig();

  // Round 1: independent existence/version checks, all in flight together.
  const [twilioInstalled, opencodeInstalled, piInstalled, nodeInfo, modelPing, hasRec, hasFfmpeg, hasArecord] = await Promise.all([
    haveAsync("twilio"),
    haveAsync("opencode"),
    haveAsync("pi"),
    pathNodeVersionAsync(),
    (fileReady && runtimeReady) ? captureAsync("curl", ["-fsS", MODEL_SERVER_URL]) : Promise.resolve(""),
    haveAsync("rec"),
    haveAsync("ffmpeg"),
    haveAsync("arecord"),
  ]);

  // Round 2: calls that depend on round 1's installed-checks — the two
  // most expensive calls (twilio profiles:list, twilio plugins) run
  // concurrently with each other instead of back-to-back.
  const [profilesRaw, pluginsRaw, opencodeVersionRaw] = await Promise.all([
    twilioInstalled ? captureAsync("twilio", ["profiles:list", "-o", "json"]) : Promise.resolve(""),
    twilioInstalled ? captureAsync("twilio", ["plugins"]) : Promise.resolve(""),
    opencodeInstalled ? captureAsync("opencode", ["--version"]) : Promise.resolve(""),
  ]);

  let profile = "";
  let sid = "";
  try {
    const profiles: Array<{ id: string; accountSid: string; active?: boolean }> = JSON.parse(profilesRaw || "[]");
    const active = profiles.find((p) => p.active) ?? profiles[0];
    if (active) { profile = active.id ?? ""; sid = active.accountSid ?? ""; }
  } catch { /* ignore */ }

  const running = Boolean(modelPing);
  const supportsPi = supportsPiNode(nodeInfo);
  const localGemmaAvailable = cfg.addons.localGemma || (fileReady && runtimeReady);
  const recorder = hasRec ? "rec" : hasFfmpeg ? "ffmpeg" : hasArecord ? "arecord" : "";

  return {
    twilio:   { installed: twilioInstalled, profile, sid },
    skills:   { count: skillCount },
    model:    { fileReady, runtimeReady, ready: fileReady && runtimeReady, running },
    voice:    { runtimeReady: whisperRuntimeReady, modelReady: whisperReady, recorder, ready: whisperRuntimeReady && whisperReady && Boolean(recorder) },
    devPhone: { installed: pluginsRaw.includes("plugin-dev-phone") },
    opencode: { installed: opencodeInstalled, version: opencodeVersionRaw.split("\n")[0] },
    pi:       { installed: piInstalled },
    node:     { version: nodeInfo?.raw ?? "not found", supportsPi },
    localGemmaAvailable,
    addons:   cfg.addons as Record<string, boolean>,
  };
}
