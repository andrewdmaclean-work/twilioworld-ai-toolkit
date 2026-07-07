// lib/setup.ts — setup workflow implementation (add-on picker is in the TUI).
// Install choices are already written to config.json before this is called.

import {
  chmodSync, existsSync, mkdirSync, writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { capture, have, runStreaming, type LogFn } from "./exec.ts";
import { addonEnabled } from "./config.ts";
import { installLocalModel } from "./model-install.ts";
import {
  CONFIG_DIR,
  NPM_GLOBAL_PREFIX,
  ROOT,
  SKILLS_DIR,
  TWILIO_CLI_HOME,
} from "./constants.ts";

function ok(msg: string, onLog: LogFn) { onLog(`✓ ${msg}`, "stdout"); }
function warn(msg: string, onLog: LogFn) { onLog(`⚠  ${msg}`, "stderr"); }
function err(msg: string, onLog: LogFn) { onLog(`✗ ${msg}`, "stderr"); }
function say(msg: string, onLog: LogFn) { onLog(msg, "stdout"); }
function step(msg: string, onLog: LogFn) { onLog(`\n▶ ${msg}`, "stdout"); }
function stepDone(msg: string, onLog: LogFn) { onLog(`☑ ${msg}`, "stdout"); }

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
  step("☐ [1/6] Checking prerequisites", onLog);
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
  stepDone("[1/6] Checking prerequisites", onLog);

  // ── Step 2: Twilio CLI ─────────────────────────────────────────────
  step("☐ [2/6] Toolkit-local Twilio CLI", onLog);
  if (have("twilio")) {
    ok(`toolkit-local twilio CLI  ${capture("twilio", ["--version"]).split("\n")[0]}`, onLog);
    ok(`profiles isolated under ${TWILIO_CLI_HOME}`, onLog);
  } else if (addonEnabled("devPhone")) {
    warn("Toolkit-local Twilio CLI not found — installing (required for Dev Phone)", onLog);
    const res = await runStreaming("npm", ["install", "--prefix", NPM_GLOBAL_PREFIX, "-g", "twilio-cli"], { cwd: ROOT, onLog });
    if (!res.ok) { err("twilio-cli install failed — see https://www.twilio.com/docs/twilio-cli/quickstart", onLog); onDone(false); return; }
    ok(`Twilio CLI installed under ${NPM_GLOBAL_PREFIX}`, onLog);
    ok(`profiles isolated under ${TWILIO_CLI_HOME}`, onLog);
  } else {
    warn("Toolkit-local Twilio CLI not installed — not needed for your selected choices", onLog);
    say("   (Install it later if you want the Execute MCP or Dev Phone.)", onLog);
  }
  stepDone("[2/6] Toolkit-local Twilio CLI", onLog);

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
  step("☐ [3/6] Execute MCP API key (optional)", onLog);
  let mcpCreds = "";
  if (!activeAccountSid) {
    warn("Not logged in to Twilio CLI — skipping Execute MCP.", onLog);
    say("   The Execute MCP is wired automatically once creds exist: run", onLog);
    say("   `twilio login`, then re-run Setup to create a scoped API key.", onLog);
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
  stepDone("[3/6] Execute MCP API key (optional)", onLog);

  // ── Step 4: Local model ────────────────────────────────────────────
  step("☐ [4/6] Local AI model — Gemma 4 E2B via llamafile", onLog);
  if (!addonEnabled("localGemma")) {
    warn("Local Gemma not selected — skipping", onLog);
  } else {
    const modelOk = await installLocalModel({ onLog, keepArchiveNotice: true });
    if (!modelOk) { onDone(false); return; }
  }
  stepDone("[4/6] Local AI model — Gemma 4 E2B via llamafile", onLog);

  // ── Step 5: Dev Phone ──────────────────────────────────────────────
  step("☐ [5/6] Dev Phone", onLog);
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
  stepDone("[5/6] Dev Phone", onLog);

  // ── Step 6: Skills ─────────────────────────────────────────────────
  step("☐ [6/6] Twilio Skills", onLog);
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

  // Always install Skills globally — they're free files on the Agent
  // Skills standard, read by every configured agent from ~/.agents/skills.
  {
    const globalSkills = join(homedir(), ".agents", "skills");
    mkdirSync(globalSkills, { recursive: true });
    const res = await runStreaming("cp", ["-r", join(SKILLS_DIR, "."), globalSkills], { cwd: ROOT, onLog });
    if (res.ok) ok("Skills installed globally to ~/.agents/skills/", onLog);
    else warn("Global skills copy failed — skills available in this repo only", onLog);
  }
  stepDone("[6/6] Twilio Skills", onLog);

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
