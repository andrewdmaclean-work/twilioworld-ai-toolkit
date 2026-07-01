import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "fs";
import {
  ROOT,
  VOICE_TMP_DIR,
  WHISPERFILE_DEST,
  WHISPER_MODEL_DEST,
  WHISPER_MODEL_MIN_BYTES,
} from "./constants.ts";
import { fileExecutable, have } from "./exec.ts";

export const VOICE_COMING_SOON = true;
export const VOICE_COMING_SOON_MESSAGE =
  "Voice input is coming soon. Ctrl+R is wired, but the Whisper model is not bundled yet.";

export interface VoiceSession {
  file: string;
  recorder: string;
  child: ChildProcess;
}

export interface VoiceReadiness {
  runtimeReady: boolean;
  modelReady: boolean;
  recorder: string;
  ready: boolean;
}

function q(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function whisperModelReady(): boolean {
  if (!existsSync(WHISPER_MODEL_DEST)) return false;
  try { return statSync(WHISPER_MODEL_DEST).size >= WHISPER_MODEL_MIN_BYTES; } catch { return false; }
}

export function detectRecorder(): string {
  if (have("rec")) return "rec";
  if (have("ffmpeg")) return "ffmpeg";
  if (have("arecord")) return "arecord";
  return "";
}

export function voiceReadiness(): VoiceReadiness {
  const runtimeReady = fileExecutable(WHISPERFILE_DEST);
  const modelReady = whisperModelReady();
  const recorder = detectRecorder();
  return { runtimeReady, modelReady, recorder, ready: !VOICE_COMING_SOON && runtimeReady && modelReady && Boolean(recorder) };
}

function recorderCommand(file: string): { command: string; args: string[]; label: string } | null {
  if (have("rec")) {
    return { command: "rec", args: ["-q", "-r", "16000", "-c", "1", "-b", "16", file], label: "rec" };
  }
  if (have("ffmpeg")) {
    if (process.platform === "darwin") {
      return { command: "ffmpeg", args: ["-y", "-f", "avfoundation", "-i", ":0", "-ar", "16000", "-ac", "1", file], label: "ffmpeg" };
    }
    if (process.platform === "win32") {
      return { command: "ffmpeg", args: ["-y", "-f", "dshow", "-i", "audio=default", "-ar", "16000", "-ac", "1", file], label: "ffmpeg" };
    }
    return { command: "ffmpeg", args: ["-y", "-f", "alsa", "-i", "default", "-ar", "16000", "-ac", "1", file], label: "ffmpeg" };
  }
  if (have("arecord")) {
    return { command: "arecord", args: ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", file], label: "arecord" };
  }
  return null;
}

export function startVoiceRecording(): { ok: true; session: VoiceSession } | { ok: false; error: string } {
  if (VOICE_COMING_SOON) return { ok: false, error: VOICE_COMING_SOON_MESSAGE };
  const ready = voiceReadiness();
  if (!ready.runtimeReady) return { ok: false, error: "whisperfile runtime missing." };
  if (!ready.modelReady) return { ok: false, error: "Whisper model missing." };
  if (!ready.recorder) return { ok: false, error: "No microphone recorder found. Install sox/rec or ffmpeg, then retry." };

  mkdirSync(VOICE_TMP_DIR, { recursive: true });
  const file = `${VOICE_TMP_DIR}/voice-${Date.now()}.wav`;
  const cmd = recorderCommand(file);
  if (!cmd) return { ok: false, error: "No microphone recorder found. Install sox/rec or ffmpeg, then retry." };

  try {
    const child = spawn(cmd.command, cmd.args, {
      cwd: ROOT,
      stdio: "ignore",
      detached: process.platform !== "win32",
    });
    child.unref();
    return { ok: true, session: { file, recorder: cmd.label, child } };
  } catch (e) {
    return { ok: false, error: `Could not start recorder: ${(e as Error).message}` };
  }
}

export function stopVoiceRecording(session: VoiceSession): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    session.child.once("close", finish);
    try {
      if (session.child.pid && process.platform !== "win32") process.kill(-session.child.pid, "SIGINT");
      else session.child.kill("SIGINT");
    } catch {
      try { session.child.kill("SIGINT"); } catch { /* ignore */ }
    }
    setTimeout(() => {
      if (done) return;
      try { session.child.kill("SIGTERM"); } catch { /* ignore */ }
      finish();
    }, 2500);
  });
}

export function cleanupVoiceRecording(session: VoiceSession): void {
  try { rmSync(session.file, { force: true }); } catch { /* ignore */ }
}

export function transcribeVoiceFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = [
      q(WHISPERFILE_DEST),
      "-m", q(WHISPER_MODEL_DEST),
      "-f", q(file),
      "--no-prints",
    ].join(" ");
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      const text = out.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (code === 0 && text) resolve(text);
      else if (code === 0) reject(new Error("No speech detected."));
      else reject(new Error((err || out || `whisperfile exited ${code}`).trim()));
    });
  });
}
