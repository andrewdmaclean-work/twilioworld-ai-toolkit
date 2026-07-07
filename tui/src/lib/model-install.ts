// lib/model-install.ts — shared local model installer.
// Setup and the Chat shortcut both use this so download/extract behavior,
// progress logs, and failure handling cannot drift.

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";
import { twilioFactAt } from "./twilio-facts.ts";
import { capture, fileExecutable, runStreaming, type LogFn } from "./exec.ts";
import {
  GGUF_DEST,
  GGUF_MIN_BYTES,
  GGUF_MMPROJ,
  GGUF_STAGING,
  GGUF_URL,
  LLAMAFILE_DEST,
  LLAMAFILE_SIZE_BYTES,
  LLAMAFILE_SIZE_LABEL,
  LLAMAFILE_URL,
  LOCAL_MODEL_SIZE_BYTES,
  LOCAL_MODEL_SIZE_LABEL,
  MODELS_DIR,
  ROOT,
  TOOLS_DIR,
} from "./constants.ts";

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

function elapsedLabel(startedAt: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
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

function startExtractionLogger(onLog: LogFn): ReturnType<typeof setInterval> {
  const startedAt = Date.now();
  let tick = 0;
  return setInterval(() => {
    onLog(`   extracting… still working (${elapsedLabel(startedAt)} elapsed)`, "stdout");
    if (tick % 3 === 0) onLog(`   Twilio AI tip: ${twilioFactAt(tick / 3)}`, "stdout");
    tick++;
  }, 5000);
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

function ggufSizeOk(): boolean {
  if (!existsSync(GGUF_DEST)) return false;
  try { return statSync(GGUF_DEST).size >= GGUF_MIN_BYTES; } catch { return false; }
}

function runtimeOk(): boolean {
  return fileExecutable(LLAMAFILE_DEST);
}

function ggufStagingExists(): boolean {
  return existsSync(GGUF_STAGING);
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

function findGgufs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findGgufs(full));
    else if (entry.isFile() && entry.name.endsWith(".gguf")) found.push(full);
  }
  return found;
}

export function localModelInstalled(): boolean {
  return runtimeOk() && ggufSizeOk();
}

export async function installLocalModel(opts: {
  onLog: LogFn;
  heading?: string;
  keepArchiveNotice?: boolean;
}): Promise<boolean> {
  const { onLog, heading, keepArchiveNotice = false } = opts;
  if (heading) step(heading, onLog);

  if (localModelInstalled()) {
    ok("llamafile runtime already present", onLog);
    ok("Model weights already present", onLog);
    if (existsSync(GGUF_MMPROJ)) ok("mmproj (multimodal) already present", onLog);
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

  if (!ggufSizeOk()) {
    if (existsSync(GGUF_DEST)) {
      const size = statSync(GGUF_DEST).size;
      warn(`Found incomplete model file (${Math.round(size / 1024 / 1024)}MB < 1.5GB) — will re-download.`, onLog);
      rmSync(GGUF_DEST);
    }

    mkdirSync(MODELS_DIR, { recursive: true });
    if (!ggufStagingExists()) {
      say(`   Downloading Gemma 4 E2B from Kaggle (~${LOCAL_MODEL_SIZE_LABEL})…`, onLog);
      const weightsProgress = startProgressLogger(GGUF_STAGING, LOCAL_MODEL_SIZE_BYTES, 3000, onLog, { facts: true });
      const res = await runStreaming("curl", curlDownloadArgs(GGUF_URL, GGUF_STAGING), { cwd: ROOT, onLog });
      clearInterval(weightsProgress);
      if (!res.ok) {
        err(`Download failed — partial file kept at ${GGUF_STAGING} so re-running can resume it.`, onLog);
        return false;
      }
    } else {
      const sz = statSync(GGUF_STAGING).size;
      ok(`Archive already present (${(sz / 1_073_741_824).toFixed(1)}GB) — skipping download`, onLog);
    }

    say("   Extracting… this can take a few minutes on a Pi-class machine.", onLog);
    const extractTmp = mkdtempSync(join(MODELS_DIR, "extract-"));
    const extractProgress = startExtractionLogger(onLog);
    const tarRes = await runStreaming("tar", ["-xf", GGUF_STAGING, "-C", extractTmp], { cwd: ROOT, onLog });
    clearInterval(extractProgress);
    if (!tarRes.ok) {
      err("Extraction failed", onLog);
      return false;
    }

    const allGgufs = findGgufs(extractTmp);
    const mmproj = allGgufs.find((f) => f.includes("mmproj"));
    const mains = allGgufs.filter((f) => !f.includes("mmproj"));
    const mainGguf = mains.sort((a, b) => statSync(b).size - statSync(a).size)[0];
    if (!mainGguf) {
      err("No main model GGUF found in archive. Left everything in place:", onLog);
      err(`  Archive:   ${GGUF_STAGING}`, onLog);
      err(`  Extracted: ${extractTmp}`, onLog);
      return false;
    }

    renameSync(mainGguf, GGUF_DEST);
    if (mmproj) renameSync(mmproj, GGUF_MMPROJ);
    rmSync(extractTmp, { recursive: true, force: true });
    ok(`Model ready (${(statSync(GGUF_DEST).size / 1_073_741_824).toFixed(1)}GB)`, onLog);
    if (keepArchiveNotice) ok(`Archive kept at ${GGUF_STAGING} — delete it to reclaim ~${LOCAL_MODEL_SIZE_LABEL}`, onLog);
  } else {
    ok("Model weights already present", onLog);
  }

  ok("Local model ready — Chat with Twilio Docs is available.", onLog);
  return true;
}
