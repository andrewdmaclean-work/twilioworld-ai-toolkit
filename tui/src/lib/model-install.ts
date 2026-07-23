// lib/model-install.ts — shared local model installer.
// Components and Ask Twilio both use this so download/extract behavior,
// progress logs, and failure handling cannot drift.

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import { twilioFactAt } from "./twilio-facts.ts";
import { capture, fileExecutable, runStreaming, type LogFn } from "./exec.ts";
import {
  LLAMAFILE_DEST,
  LLAMAFILE_SIZE_BYTES,
  LLAMAFILE_SIZE_LABEL,
  LLAMAFILE_URL,
  MODELS_DIR,
  ROOT,
  TOOLS_DIR,
} from "./constants.ts";
import type { LocalModel } from "./local-models.ts";

function ok(msg: string, onLog: LogFn) { onLog(`✓ ${msg}`, "stdout"); }
function warn(msg: string, onLog: LogFn) { onLog(`⚠  ${msg}`, "stderr"); }
function err(msg: string, onLog: LogFn) { onLog(`✗ ${msg}`, "stderr"); }
function say(msg: string, onLog: LogFn) { onLog(msg, "stdout"); }
function step(msg: string, onLog: LogFn) { onLog(`\n▶ ${msg}`, "stdout"); }

function sizeLabel(bytes: number): string {
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

function startProgressLogger(
  dest: string,
  totalBytes: number,
  intervalMs: number,
  onLog: LogFn,
  opts: { facts?: boolean } = {},
): ReturnType<typeof setInterval> {
  let tick = 0;
  if (opts.facts) onLog(`   Twilio AI tip: ${twilioFactAt(tick++)}`, "stdout");
  return setInterval(() => {
    try {
      const downloaded = existsSync(dest) ? statSync(dest).size : 0;
      const pct = totalBytes > 0 ? Math.min(100, Math.round((downloaded / totalBytes) * 100)) : 0;
      onLog(`   downloading… ${sizeLabel(downloaded)} / ${sizeLabel(totalBytes)}  (${pct}%)`, "stdout");
      if (opts.facts && tick % 5 === 0) onLog(`   Twilio AI tip: ${twilioFactAt(tick / 5)}`, "stdout");
      tick++;
    } catch {
      // File may not exist yet.
    }
  }, intervalMs);
}

// Bound redirects and resume partial downloads.
function curlDownloadArgs(url: string, dest: string): string[] {
  return ["-fL", "--max-redirs", "5", "-C", "-", "--no-progress-meter", url, "-o", dest];
}

function looksLikeExecutable(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(4);
      const n = readSync(fd, buf, 0, 4, 0);
      if (n < 2) return false;
      if (buf[0] === 0x4d && buf[1] === 0x5a) return true; // MZ (APE)
      if (buf.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true; // ELF
      const magic = buf.readUInt32BE(0);
      return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function ggufSizeOk(model: LocalModel): boolean {
  if (!existsSync(model.dest)) return false;
  try { return statSync(model.dest).size >= model.minBytes; } catch { return false; }
}

function runtimeOk(): boolean {
  return fileExecutable(LLAMAFILE_DEST);
}

function ggufStagingExists(model: LocalModel): boolean {
  return existsSync(model.staging);
}

function freeKb(): number {
  try {
    const out = capture("df", ["-k", MODELS_DIR.replace(/\/models$/, "") || ROOT]);
    const match = out.split("\n").find((l) => !l.startsWith("Filesystem"));
    if (!match) return Infinity;
    return parseInt(match.trim().split(/\s+/)[3] ?? "0", 10);
  } catch {
    return Infinity;
  }
}

export async function installLocalModel(opts: {
  model: LocalModel;
  onLog: LogFn;
  heading?: string;
}): Promise<boolean> {
  const { model, onLog, heading } = opts;
  if (heading) step(heading, onLog);

  if (runtimeOk() && ggufSizeOk(model)) {
    ok("llamafile runtime already present", onLog);
    ok("Model weights already present", onLog);
    return true;
  }

  const freeKbVal = freeKb();
  if (freeKbVal < 5_242_880) {
    err(`Only ${Math.round(freeKbVal / 1024)}MB free — need ~5GB. Free up space then re-run.`, onLog);
    return false;
  }

  if (!runtimeOk()) {
    say(`   Downloading llamafile runtime (~${LLAMAFILE_SIZE_LABEL})…`, onLog);
    mkdirSync(TOOLS_DIR, { recursive: true });
    const runtimeProgress = startProgressLogger(LLAMAFILE_DEST, LLAMAFILE_SIZE_BYTES, 3000, onLog);
    const res = await runStreaming("curl", curlDownloadArgs(LLAMAFILE_URL, LLAMAFILE_DEST), { cwd: ROOT, onLog });
    clearInterval(runtimeProgress);
    if (!res.ok) {
      err("Runtime download failed", onLog);
      return false;
    }
    if (!looksLikeExecutable(LLAMAFILE_DEST)) {
      err("Downloaded runtime isn't a valid binary — removing it.", onLog);
      rmSync(LLAMAFILE_DEST, { force: true });
      return false;
    }
    chmodSync(LLAMAFILE_DEST, 0o755);
    ok("llamafile runtime ready", onLog);
  } else {
    ok("llamafile runtime already present", onLog);
  }

  if (!ggufSizeOk(model)) {
    if (existsSync(model.dest)) {
      const size = statSync(model.dest).size;
      warn(`Found incomplete model file (${Math.round(size / 1024 / 1024)}MB < 1.5GB) — will re-download.`, onLog);
      rmSync(model.dest);
    }

    mkdirSync(MODELS_DIR, { recursive: true });
    if (!ggufStagingExists(model)) {
      say(`   Downloading ${model.name} (~${model.sizeLabel})…`, onLog);
      const weightsProgress = startProgressLogger(model.staging, model.sizeBytes, 3000, onLog, { facts: true });
      const res = await runStreaming("curl", curlDownloadArgs(model.url, model.staging), { cwd: ROOT, onLog });
      clearInterval(weightsProgress);
      if (!res.ok) {
        err(`Download failed — partial file kept at ${model.staging} so re-running can resume it.`, onLog);
        return false;
      }
    } else {
      const sz = statSync(model.staging).size;
      ok(`Partial download present (${(sz / 1_073_741_824).toFixed(1)}GB) — resuming`, onLog);
    }

    renameSync(model.staging, model.dest);
    ok(`Model ready (${(statSync(model.dest).size / 1_073_741_824).toFixed(1)}GB)`, onLog);
  } else {
    ok("Model weights already present", onLog);
  }

  ok("Local model ready — Ask Twilio is available.", onLog);
  return true;
}
