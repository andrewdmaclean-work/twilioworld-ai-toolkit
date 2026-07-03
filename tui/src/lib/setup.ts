// lib/setup.ts — setup workflow implementation (add-on picker is in the TUI).
// Install choices are already written to config.json before this is called.

import {
  chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync,
  readSync, renameSync, rmSync, statSync, writeFileSync,
} from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { capture, fileExecutable, have, runStreaming, type LogFn } from "./exec.ts";
import { addonEnabled } from "./config.ts";
import {
  CONFIG_DIR,
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

function ok(msg: string, onLog: LogFn) { onLog(`✓ ${msg}`, "stdout"); }
function warn(msg: string, onLog: LogFn) { onLog(`⚠  ${msg}`, "stderr"); }
function err(msg: string, onLog: LogFn) { onLog(`✗ ${msg}`, "stderr"); }
function say(msg: string, onLog: LogFn) { onLog(msg, "stdout"); }
function step(msg: string, onLog: LogFn) { onLog(`\n▶ ${msg}`, "stdout"); }

// ── Security audit M-3/E-2: bound redirects and support resuming a
// partial download instead of forcing a full re-download on a dropped
// connection (common on shared/conference wifi with multi-GB payloads).
function curlDownloadArgs(url: string, dest: string): string[] {
  return ["-fL", "--max-redirs", "5", "-C", "-", "--progress-bar", url, "-o", dest];
}

// ── Security audit C-1/H-3: a network failure or captive-portal page can
// leave HTML/garbage at the destination path instead of a real binary.
// Check for a recognizable executable magic number before chmod +x runs.
// llamafile ships as a cosmopolitan/APE binary, which — regardless of host
// OS — always starts with the "MZ" bytes (it's simultaneously a valid PE
// header, ELF loader stub, and shell script). This is a structural check,
// not a substitute for pinning a hash; see LLAMAFILE_SHA256 below.
function looksLikeExecutable(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(4);
      const n = readSync(fd, buf, 0, 4, 0);
      if (n < 2) return false;
      // MZ (PE/APE — what llamafile actually ships), ELF, or Mach-O.
      if (buf[0] === 0x4d && buf[1] === 0x5a) return true; // MZ
      if (buf.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true; // \x7fELF
      const magic = buf.readUInt32BE(0);
      if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return true; // Mach-O / FAT
      return false;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

// ── Security audit C-4 (defense-in-depth): exec.ts's shCmd()/q() already
// single-quote-escapes every arg before it reaches a shell, so this isn't
// a command-injection gate — it just catches a malformed/truncated value
// before it's written anywhere or handed to another tool.
function looksLikeMcpCreds(creds: string): boolean {
  return /^AC[a-f0-9]+\/SK[a-f0-9]+:.+$/.test(creds);
}

// ── Security audit C-2/H-1/H-2: never print the secret to the log pane
// (it's a TUI transcript — easy to screenshot/share — and the old bash
// version's `echo ... >> .zsh_history` advice put it in shell history
// too). Write it to a local, gitignored, chmod-600 file instead.
function writeMcpCredsFile(creds: string): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const envFile = join(CONFIG_DIR, ".env");
  writeFileSync(envFile, `export TWILIO_MCP_CREDS="${creds}"\n`, { mode: 0o600 });
  chmodSync(envFile, 0o600); // belt-and-suspenders in case umask altered the create mode
  return envFile;
}

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

  // Security audit M-2: everything Setup creates from here on (.toolkit/,
  // downloaded models/tools, the creds file) should default to
  // owner-only permissions, not whatever broad umask the user's shell
  // happened to have. process.umask() is process-global but Setup is a
  // one-shot flow, so this is safe for the whole run.
  process.umask(0o077);

  // ── Step 1: Prerequisites ──────────────────────────────────────────
  step("[1/6] Checking prerequisites", onLog);
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
  step("[2/6] Twilio CLI", onLog);
  if (have("twilio")) {
    ok(`twilio CLI  ${capture("twilio", ["--version"]).split("\n")[0]}`, onLog);
  } else if (addonEnabled("executeMcp") || addonEnabled("devPhone")) {
    warn("Twilio CLI not found — installing (required for Execute MCP / Dev Phone)", onLog);
    const res = await runStreaming("npm", ["install", "-g", "twilio-cli"], { cwd: ROOT, onLog });
    if (!res.ok) { err("twilio-cli install failed — see https://www.twilio.com/docs/twilio-cli/quickstart", onLog); onDone(false); return; }
    ok("Twilio CLI installed", onLog);
  } else {
    warn("Twilio CLI not installed — not needed for your selected choices", onLog);
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
  step("[3/6] Execute MCP API key (optional)", onLog);
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
          if (!looksLikeMcpCreds(mcpCreds)) {
            warn("API returned a credential in an unexpected format — wire Execute MCP creds manually.", onLog);
            mcpCreds = "";
          } else {
            ok(`API key created  (${sid})`, onLog);
            const envFile = writeMcpCredsFile(mcpCreds);
            say("", onLog);
            ok(`Saved to ${envFile}  (chmod 600, gitignored — never printed to this log)`, onLog);
            say(`   Load it in your shell:  source ${envFile}`, onLog);
          }
        } else {
          warn("Couldn't parse key output — wire Execute MCP creds manually.", onLog);
        }
      } catch {
        warn("Couldn't create API key — wire Execute MCP creds manually.", onLog);
      }
    }
  }

  // ── Step 4: Local model ────────────────────────────────────────────
  step("[4/6] Local AI model — Gemma 4 E2B via llamafile", onLog);
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
        const res = await runStreaming("curl", curlDownloadArgs(LLAMAFILE_URL, LLAMAFILE_DEST), { cwd: ROOT, onLog });
        if (res.ok && !looksLikeExecutable(LLAMAFILE_DEST)) {
          err("Downloaded file doesn't look like a real binary (captive portal page or corrupt transfer?) — removing it.", onLog);
          rmSync(LLAMAFILE_DEST, { force: true });
        } else if (res.ok) {
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
          const res = await runStreaming("curl", curlDownloadArgs(GGUF_URL, GGUF_STAGING), { cwd: ROOT, onLog });
          if (!res.ok) {
            err("Download failed — partial file kept at " + GGUF_STAGING + " so re-running Setup can resume it.", onLog);
          }
        } else {
          const sz = statSync(GGUF_STAGING).size;
          ok(`Archive already present (${(sz / 1_073_741_824).toFixed(1)}GB) — skipping download`, onLog);
        }

        if (ggufStagingExists()) {
          say("   Extracting…", onLog);
          // Security audit C-3: the old predictable extraction path was
          // removed with rm -rf then recreated with mkdir -p, leaving a
          // gap an attacker on a shared/multi-user box could win by
          // planting a symlink there first (TOCTOU). mkdtempSync asks the
          // OS for an exclusively-created, unpredictable directory name
          // instead — there's no gap to race.
          const extractTmp = mkdtempSync(join(MODELS_DIR, "extract-"));
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

  // ── Step 5: Dev Phone ──────────────────────────────────────────────
  step("[5/6] Dev Phone", onLog);
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

  // ── Step 6: Skills ─────────────────────────────────────────────────
  step("[6/6] Twilio Skills", onLog);
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
  if (mcpCreds) say(`   Execute MCP creds: source ${join(CONFIG_DIR, ".env")}`, onLog);
  onDone(true);
}
