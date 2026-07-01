// lib/setup.ts — setup workflow implementation (add-on picker is in the TUI).
// Add-ons are already written to config.json before this is called.

import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { capture, fileExecutable, have, runStreaming, type LogFn } from "./exec.ts";
import { addonEnabled } from "./config.ts";
import {
  DOCS_MCP_URL,
  GGUF_DEST,
  GGUF_MIN_BYTES,
  GGUF_MMPROJ,
  GGUF_STAGING,
  LLAMAFILE_DEST,
  LLAMAFILE_URL,
  MODELS_DIR,
  ROOT,
  SKILLS_DIR,
  TOOLS_DIR,
  TWILIO_MCP_PKG,
  GGUF_URL,
} from "./constants.ts";
import { VOICE_COMING_SOON_MESSAGE } from "./voice.ts";

function ok(msg: string, onLog: LogFn) { onLog(`✓ ${msg}`, "stdout"); }
function warn(msg: string, onLog: LogFn) { onLog(`⚠  ${msg}`, "stderr"); }
function err(msg: string, onLog: LogFn) { onLog(`✗ ${msg}`, "stderr"); }
function say(msg: string, onLog: LogFn) { onLog(msg, "stdout"); }
function step(msg: string, onLog: LogFn) { onLog(`\n▶ ${msg}`, "stdout"); }

// ── Model helpers ─────────────────────────────────────────────────────
function ggufSizeOk(): boolean {
  if (!existsSync(GGUF_DEST)) return false;
  try { return statSync(GGUF_DEST).size >= GGUF_MIN_BYTES; } catch { return false; }
}

function ggufStagingExists(): boolean { return existsSync(GGUF_STAGING); }
function runtimeOk(): boolean { return fileExecutable(LLAMAFILE_DEST); }

// ── Disk space preflight (df -k portable) ────────────────────────────
function freeKb(): number {
  try {
    const out = capture("df", ["-k", MODELS_DIR.replace(/\/models$/, "") || ROOT]);
    const match = out.split("\n").find((l) => !l.startsWith("Filesystem"));
    if (!match) return Infinity;
    const parts = match.trim().split(/\s+/);
    return parseInt(parts[3] ?? "0", 10);
  } catch { return Infinity; }
}

// ── GGUF extraction helpers ───────────────────────────────────────────
function findGgufs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findGgufs(full));
    else if (entry.isFile() && entry.name.endsWith(".gguf")) found.push(full);
  }
  return found;
}

// ── Main export ───────────────────────────────────────────────────────
export async function runSetup(opts: {
  onLog: LogFn;
  onDone: (ok: boolean) => void;
}): Promise<void> {
  const { onLog, onDone } = opts;

  // ── Step 1: Prerequisites ──────────────────────────────────────────
  step("[1/7] Checking prerequisites", onLog);
  let missing = false;
  for (const tool of ["node", "git", "curl"]) {
    if (have(tool)) {
      const ver = capture(tool, ["--version"]).split("\n")[0];
      ok(`${tool}  ${ver}`, onLog);
    } else {
      err(`${tool} not found — install it then re-run Setup`, onLog);
      missing = true;
    }
  }
  if (missing) { onDone(false); return; }

  // ── Step 2: Twilio CLI ─────────────────────────────────────────────
  step("[2/7] Twilio CLI", onLog);
  if (have("twilio")) {
    ok(`twilio CLI  ${capture("twilio", ["--version"]).split("\n")[0]}`, onLog);
  } else if (addonEnabled("executeMcp") || addonEnabled("devPhone")) {
    warn("Twilio CLI not found — installing (required for Execute MCP / Dev Phone)", onLog);
    const res = await runStreaming("npm", ["install", "-g", "twilio-cli"], { cwd: ROOT, onLog });
    if (!res.ok) { err("twilio-cli install failed — see https://www.twilio.com/docs/twilio-cli/quickstart", onLog); onDone(false); return; }
    ok("Twilio CLI installed", onLog);
  } else {
    warn("Twilio CLI not installed — not needed for your selected add-ons", onLog);
  }

  // ── Twilio account (optional — only needed for Execute MCP) ────────
  let activeAccountSid = "";
  let activeProfileName = "";
  if (have("twilio")) {
    try {
      const profilesJson = capture("twilio", ["profiles:list", "-o", "json"]);
      const profiles: Array<{ id: string; accountSid: string; active?: boolean }> =
        profilesJson ? JSON.parse(profilesJson) : [];
      const active = profiles.find((p) => p.active) ?? profiles[0];
      if (active) {
        activeAccountSid = active.accountSid ?? "";
        activeProfileName = active.id ?? "";
      }
    } catch { /* ignore */ }

    if (!activeAccountSid) {
      warn("Not logged in to Twilio CLI — Execute MCP will be skipped. Run `twilio login` then re-run Setup.", onLog);
    } else {
      // Verify credentials
      const check = capture("twilio", ["api:core:accounts:fetch", "--sid", activeAccountSid, "-o", "json"]);
      if (!check || check === "[]") {
        warn(`Credentials for '${activeProfileName}' appear stale — run \`twilio login\` then re-run Setup.`, onLog);
        activeAccountSid = "";
      } else {
        ok(`Logged in as ${activeProfileName} (${activeAccountSid})`, onLog);
      }
    }
  }

  // ── Step 3: API key for Execute MCP ───────────────────────────────
  step("[3/7] Execute MCP API key (optional)", onLog);
  let mcpCreds = "";
  if (!addonEnabled("executeMcp")) {
    warn("Execute MCP not selected — skipping", onLog);
  } else if (!activeAccountSid) {
    warn("No confirmed Twilio account — skipping Execute MCP. Log in with `twilio login` and re-run Setup.", onLog);
  } else {
    // Check for existing key
    const keysJson = capture("twilio", ["api:core:keys:list", "-o", "json"]);
    warn("The Execute MCP (EXPERIMENTAL) can call any Twilio API on this account,", onLog);
    warn("including sending messages, making calls, and deleting resources.", onLog);
    warn("Recommend: set a spend limit at console.twilio.com/billing before continuing.", onLog);
    let existingSk = "";
    try {
      const keys: Array<{ friendlyName: string; sid: string }> = JSON.parse(keysJson || "[]");
      existingSk = keys.find((k) => k.friendlyName === "twilioworld-toolkit")?.sid ?? "";
    } catch { /* ignore */ }

    if (existingSk) {
      warn(`Key 'twilioworld-toolkit' already exists on this account (${existingSk}).`, onLog);
      warn("The secret is not recoverable. To recreate: twilio api:core:keys:remove --sid " + existingSk, onLog);
    } else {
      const keyJson = capture("twilio", ["api:core:keys:create", "--friendly-name", "twilioworld-toolkit", "-o", "json"]);
      try {
        const parsed = JSON.parse(keyJson || "[]");
        const entry = Array.isArray(parsed) ? parsed[0] : parsed;
        const sid = entry?.sid ?? "";
        const secret = entry?.secret ?? "";
        if (sid && secret) {
          mcpCreds = `${activeAccountSid}/${sid}:${secret}`;
          ok(`API key created  (${sid})`, onLog);
          say("", onLog);
          warn("SECRET SHOWN ONCE ONLY — do not screenshot or share your screen right now.", onLog);
          say(`   TWILIO_MCP_CREDS=${mcpCreds}`, onLog);
          say("", onLog);
          say("   Save it: echo 'export TWILIO_MCP_CREDS=\"" + mcpCreds + "\"' >> .env", onLog);
        } else {
          warn("Couldn't parse key output — wire Execute MCP creds manually.", onLog);
        }
      } catch {
        warn("Couldn't create API key — wire Execute MCP creds manually.", onLog);
      }
    }
  }

  // ── Step 4: Local model ────────────────────────────────────────────
  step("[4/7] Local AI model — Gemma 4 E2B via llamafile", onLog);
  if (!addonEnabled("localGemma")) {
    warn("Local Gemma not selected — skipping", onLog);
  } else if (runtimeOk() && ggufSizeOk()) {
    ok("llamafile runtime already present", onLog);
    ok("Model weights already present", onLog);
    if (existsSync(GGUF_MMPROJ)) ok("mmproj (multimodal) already present", onLog);
  } else {
    const freeKbVal = freeKb();
    if (freeKbVal < 5_242_880) {
      warn(`Only ${Math.round(freeKbVal / 1024)}MB free — need ~5GB. Free up space then re-run.`, onLog);
    } else {
      // Llamafile runtime
      if (!runtimeOk()) {
        say(`   Downloading llamafile runtime…`, onLog);
        mkdirSync(TOOLS_DIR, { recursive: true });
        const res = await runStreaming("curl", ["-fL", "--progress-bar", LLAMAFILE_URL, "-o", LLAMAFILE_DEST], { cwd: ROOT, onLog });
        if (res.ok) {
          chmodSync(LLAMAFILE_DEST, 0o755);
          ok("llamafile runtime ready", onLog);
        } else {
          err("Runtime download failed", onLog);
        }
      } else {
        ok("llamafile runtime already present", onLog);
      }

      // GGUF weights
      if (!ggufSizeOk()) {
        // Clean up corrupt/partial dest if it exists
        if (existsSync(GGUF_DEST)) {
          const size = statSync(GGUF_DEST).size;
          warn(`Found incomplete model file (${Math.round(size / 1024 / 1024)}MB < 1.5GB) — will re-download.`, onLog);
          rmSync(GGUF_DEST);
        }

        mkdirSync(MODELS_DIR, { recursive: true });
        if (!ggufStagingExists()) {
          say("   Downloading Gemma 4 E2B from Kaggle (~2.5GB)…", onLog);
          const res = await runStreaming("curl", ["-fL", "--progress-bar", GGUF_URL, "-o", GGUF_STAGING], { cwd: ROOT, onLog });
          if (!res.ok) {
            err("Download failed. Partial file kept at: " + GGUF_STAGING, onLog);
          }
        } else {
          const sz = statSync(GGUF_STAGING).size;
          ok(`Archive already present (${(sz / 1_073_741_824).toFixed(1)}GB) — skipping download`, onLog);
        }

        if (ggufStagingExists()) {
          say("   Extracting…", onLog);
          const extractTmp = join(MODELS_DIR, "extract_tmp");
          rmSync(extractTmp, { recursive: true, force: true });
          mkdirSync(extractTmp, { recursive: true });
          const tarRes = await runStreaming("tar", ["-xf", GGUF_STAGING, "-C", extractTmp], { cwd: ROOT, onLog });
          if (!tarRes.ok) {
            err("Extraction failed", onLog);
          } else {
            const allGgufs = findGgufs(extractTmp);
            const mmproj = allGgufs.find((f) => f.includes("mmproj"));
            const mains = allGgufs.filter((f) => !f.includes("mmproj"));
            // Largest main GGUF
            const mainGguf = mains.sort((a, b) => statSync(b).size - statSync(a).size)[0];
            if (mainGguf) {
              renameSync(mainGguf, GGUF_DEST);
              if (mmproj) renameSync(mmproj, GGUF_MMPROJ);
              rmSync(extractTmp, { recursive: true, force: true });
              const sz = statSync(GGUF_DEST).size;
              ok(`Model ready (${(sz / 1_073_741_824).toFixed(1)}GB)`, onLog);
              ok("Archive kept at " + GGUF_STAGING + " — delete it to reclaim ~2.5GB", onLog);
            } else {
              err("No main model GGUF found in archive. Left everything in place:", onLog);
              err("  Archive:   " + GGUF_STAGING, onLog);
              err("  Extracted: " + extractTmp, onLog);
            }
          }
        }
      } else {
        ok("Model weights already present", onLog);
      }
    }
  }

  // ── Step 5: Voice input ────────────────────────────────────────────
  step("[5/7] Voice input — coming soon", onLog);
  if (!addonEnabled("voiceInput")) {
    warn("Voice input not selected — skipping", onLog);
  } else {
    warn(VOICE_COMING_SOON_MESSAGE, onLog);
    say("   Planned runtime: tools/whisperfile", onLog);
    say("   Planned model:   models/whisper-tiny.en-q5_1.bin", onLog);
    say("   Planned command: whisperfile -m models/whisper-tiny.en-q5_1.bin -f <audio> --no-prints", onLog);
    if (have("rec")) ok("Future microphone recorder detected (rec)", onLog);
    else if (have("ffmpeg")) ok("Future microphone recorder detected (ffmpeg)", onLog);
    else if (have("arecord")) ok("Future microphone recorder detected (arecord)", onLog);
    else warn("No recorder found yet. Future voice input will need sox/rec, ffmpeg, or arecord.", onLog);
  }

  // ── Step 6: Dev Phone ──────────────────────────────────────────────
  step("[6/7] Dev Phone", onLog);
  if (!addonEnabled("devPhone")) {
    warn("Dev Phone not selected — skipping", onLog);
  } else if (!have("twilio")) {
    warn("Twilio CLI not available — cannot install Dev Phone", onLog);
  } else {
    const plugins = capture("twilio", ["plugins"]);
    if (plugins.includes("plugin-dev-phone")) {
      ok("Dev Phone plugin already installed", onLog);
    } else {
      const res = await runStreaming("twilio", ["plugins:install", "@twilio-labs/plugin-dev-phone"], { cwd: ROOT, onLog });
      if (res.ok) ok("Dev Phone installed", onLog);
      else warn("Dev Phone install failed (non-fatal)", onLog);
    }
    warn("Dev Phone OVERWRITES a number's webhooks — use a spare number, not production.", onLog);
  }

  // ── Step 7: Skills ─────────────────────────────────────────────────
  step("[7/7] Twilio Skills", onLog);
  const skillsReadme = join(ROOT, "vendor", "twilio-ai", "skills", "README.md");
  if (!existsSync(skillsReadme)) {
    say("   Pulling skills (git submodule)…", onLog);
    const res = await runStreaming("git", ["submodule", "update", "--init", "--recursive"], { cwd: ROOT, onLog });
    if (res.ok) ok("Skills pulled", onLog);
    else err("Submodule init failed", onLog);
  }
  let skillCount = 0;
  try {
    const countOut = capture("find", [SKILLS_DIR, "-name", "SKILL.md"]);
    skillCount = countOut.split("\n").filter(Boolean).length;
  } catch { /* ignore */ }
  ok(`${skillCount} skills available`, onLog);

  if (addonEnabled("twilioSkills")) {
    const globalSkills = join(homedir(), ".agents", "skills");
    mkdirSync(globalSkills, { recursive: true });
    const res = await runStreaming("cp", ["-r", join(SKILLS_DIR, "."), globalSkills], { cwd: ROOT, onLog });
    if (res.ok) ok("Skills installed globally to ~/.agents/skills/", onLog);
    else warn("Global skills copy failed — skills available in this repo only", onLog);
  }

  // ── Verify ─────────────────────────────────────────────────────────
  if (activeAccountSid) {
    const check = capture("twilio", ["api:core:accounts:fetch", "--sid", activeAccountSid, "-o", "json"]);
    if (check && check !== "[]") ok("Twilio API reachable — credentials work", onLog);
    else warn("Could not reach Twilio API — check your connection and run `twilio login`", onLog);
  }

  say("", onLog);
  ok("Setup complete.", onLog);
  if (mcpCreds) say(`   TWILIO_MCP_CREDS=${mcpCreds}`, onLog);
  onDone(true);
}
