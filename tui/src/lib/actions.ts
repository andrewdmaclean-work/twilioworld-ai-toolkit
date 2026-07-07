// lib/actions.ts — focused, single-purpose streaming actions used by the
// dashboard submenus (Chat, Dev Phone, Twilio CLI). Each mirrors a slice
// of runSetup() but can be triggered on its own from a submenu, so the
// user never has to visit a monolithic "Setup" screen.

import { join } from "path";
import { capture, have, killModelServer, openInNewWindow, runStreaming, type LogFn, type NewWindowResult } from "./exec.ts";
import { installLocalModel } from "./model-install.ts";
import { ROOT } from "./constants.ts";

function ok(msg: string, onLog: LogFn) { onLog(`✓ ${msg}`, "stdout"); }
function warn(msg: string, onLog: LogFn) { onLog(`⚠  ${msg}`, "stderr"); }
function err(msg: string, onLog: LogFn) { onLog(`✗ ${msg}`, "stderr"); }
function say(msg: string, onLog: LogFn) { onLog(msg, "stdout"); }
function step(msg: string, onLog: LogFn) { onLog(`\n▶ ${msg}`, "stdout"); }

/** Download the local Gemma model + llamafile runtime. Chat's only dependency. */
export async function downloadLocalModel(opts: { onLog: LogFn; onDone: (ok: boolean) => void }): Promise<void> {
  const { onLog, onDone } = opts;
  const ok = await installLocalModel({ onLog, heading: "Local AI model — Gemma 4 E2B via llamafile" });
  onDone(ok);
}

/** Install the Twilio CLI globally via npm. */
export async function installTwilioCli(opts: { onLog: LogFn; onDone: (ok: boolean) => void }): Promise<void> {
  const { onLog, onDone } = opts;
  step("Twilio CLI", onLog);
  if (have("twilio")) { ok(`Already installed  ${capture("twilio", ["--version"]).split("\n")[0]}`, onLog); onDone(true); return; }
  if (!have("npm")) { err("npm not found — install Node.js first.", onLog); onDone(false); return; }
  const res = await runStreaming("npm", ["install", "-g", "twilio-cli"], { cwd: ROOT, onLog });
  if (res.ok) { ok("Twilio CLI installed", onLog); onDone(true); }
  else { err("Install failed — see https://www.twilio.com/docs/twilio-cli/quickstart", onLog); onDone(false); }
}

/** Install the Dev Phone plugin (installs the CLI first if needed). */
export async function installDevPhone(opts: { onLog: LogFn; onDone: (ok: boolean) => void }): Promise<void> {
  const { onLog, onDone } = opts;
  if (!have("twilio")) {
    await installTwilioCli({ onLog, onDone: () => {} });
    if (!have("twilio")) { err("Twilio CLI required for Dev Phone.", onLog); onDone(false); return; }
  }
  step("Dev Phone plugin", onLog);
  const plugins = capture("twilio", ["plugins"]);
  if (plugins.includes("plugin-dev-phone")) { ok("Dev Phone already installed", onLog); onDone(true); return; }
  const res = await runStreaming("twilio", ["plugins:install", "@twilio-labs/plugin-dev-phone"], { cwd: ROOT, onLog });
  if (res.ok) { ok("Dev Phone installed", onLog); onDone(true); }
  else { err("Dev Phone install failed", onLog); onDone(false); }
}

/** Launch Dev Phone in a new terminal window. */
export function openDevPhone(): NewWindowResult {
  return openInNewWindow("twilio", ["dev-phone"], { cwd: ROOT });
}

/** Open a new terminal with the Twilio CLI on PATH. */
export function openTwilioTerminal(): NewWindowResult {
  // Drop into an interactive shell so the user can run twilio commands.
  return openInNewWindow(process.env.SHELL || "bash", [], { cwd: ROOT });
}

/** Launch `twilio login` in a new terminal (interactive prompts). */
export function openTwilioLogin(): NewWindowResult {
  return openInNewWindow("twilio", ["login"], { cwd: ROOT });
}

// ── Twilio profiles (account switching) ──────────────────────────────
export interface TwilioProfile { id: string; accountSid: string; active: boolean; }

/** List configured Twilio CLI profiles. */
export function listTwilioProfiles(): TwilioProfile[] {
  if (!have("twilio")) return [];
  try {
    const raw = capture("twilio", ["profiles:list", "-o", "json"]);
    const rows: Array<{ id?: string; accountSid?: string; active?: boolean }> = JSON.parse(raw || "[]");
    return rows.map((r) => ({ id: r.id ?? "", accountSid: r.accountSid ?? "", active: Boolean(r.active) }));
  } catch { return []; }
}

/** Switch the active Twilio CLI profile. Returns true on success. */
export function useTwilioProfile(id: string): boolean {
  if (!have("twilio") || !id) return false;
  try {
    // profiles:use is non-interactive — it just flips the active profile.
    const res = spawnSyncOk("twilio", ["profiles:use", id]);
    return res;
  } catch { return false; }
}

function spawnSyncOk(cmd: string, args: string[]): boolean {
  // capture() returns stdout ("" on failure); profiles:use prints a
  // confirmation on success, so treat any non-error return as success by
  // re-reading the active profile.
  capture(cmd, args);
  return listTwilioProfiles().some((p) => p.active && p.id === args[args.length - 1]);
}

/** Stop the background model server + MCP proxy. */
export function stopModelServer(): boolean {
  return killModelServer();
}

// ── Execute MCP (experimental) ───────────────────────────────────────
// Creates a scoped Twilio API key so agents can call real Twilio APIs,
// and writes it to .toolkit/.env (chmod 600, gitignored, never printed).
// This is the one risky capability — it can send messages, make calls,
// and delete resources — so it's opt-in and lives under the Twilio CLI hub.

export function activeAccountSid(): string {
  try {
    const raw = capture("twilio", ["profiles:list", "-o", "json"]);
    const profiles: Array<{ id: string; accountSid: string; active?: boolean }> = JSON.parse(raw || "[]");
    const active = profiles.find((p) => p.active) ?? profiles[0];
    return active?.accountSid ?? "";
  } catch { return ""; }
}

function looksLikeMcpCreds(creds: string): boolean {
  // Format: <AccountSid>/<KeySid>:<secret>
  // SIDs are 34 chars: 2-letter prefix + 32 case-insensitive hex.
  // The secret is opaque (base64-ish: letters, digits, + / = etc), so we
  // only require it to be non-empty.
  return /^AC[a-fA-F0-9]{32}\/SK[a-fA-F0-9]{32}:.+$/.test(creds);
}

// Read-only restricted-key policy.
//
// The v1 Keys API takes a Policy of the form { "allow": ["/twilio/.../read", ...] }
// — a flat list of named permission strings. Only permission strings from
// Twilio's catalog are accepted; an unknown string causes error 70002 and
// rejects the whole key. Twilio's official docs currently document exactly
// one such string (messaging read), so we use that as the reliable default.
// The full catalog lives in the per-product PDFs at:
// https://www.twilio.com/docs/iam/api-keys/restricted-api-keys
// (Add more here only once verified against a real account.)
function readOnlyAllowList(): string[] {
  return [
    "/twilio/messaging/messages/read",
  ];
}

export async function setupExecuteMcp(opts: { accountSid: string; authToken: string; onLog: LogFn; onDone: (ok: boolean) => void }): Promise<void> {
  const { accountSid, authToken, onLog, onDone } = opts;
  const { writeFileSync, mkdirSync: mkdir, chmodSync: chmod } = await import("fs");
  const { join: pathJoin } = await import("path");
  const { CONFIG_DIR } = await import("./constants.ts");

  step("Execute MCP — read-only API key", onLog);

  if (!have("twilio")) {
    err("Twilio CLI not installed. Install it first (Twilio CLI → Open a terminal).", onLog);
    onDone(false); return;
  }
  if (!/^AC[a-fA-F0-9]{32}$/.test(accountSid) || !authToken) {
    err("Missing or malformed Account SID / Auth Token.", onLog);
    onDone(false); return;
  }

  // Use the provided Account SID + Auth Token directly (not the CLI profile).
  // Creating restricted keys over the REST API requires the Auth Token or a
  // Main key — a Standard API key (what `twilio login` stores) is denied.
  const authEnv: NodeJS.ProcessEnv = {
    ...process.env,
    TWILIO_ACCOUNT_SID: accountSid,
    TWILIO_AUTH_TOKEN: authToken,
  };

  warn("This creates a RESTRICTED, READ-ONLY key for the Execute MCP.", onLog);
  warn("Agents can inspect the account (messages, calls, numbers, usage) but", onLog);
  warn("cannot send, create, update, or delete anything.", onLog);
  say("   The Auth Token is used only for this request and is never saved.", onLog);

  const keysJson = capture("twilio", ["api:core:keys:list", "-o", "json"], authEnv);
  let existingSk = "";
  try {
    const keys: Array<{ friendlyName?: string; sid?: string }> = JSON.parse(keysJson || "[]");
    existingSk = keys.find((k) => k.friendlyName === "twilioworld-toolkit")?.sid ?? "";
  } catch { /* ignore */ }

  if (existingSk) {
    warn(`Key 'twilioworld-toolkit' already exists (${existingSk}).`, onLog);
    warn("Its secret is not recoverable. To recreate, first remove it:", onLog);
    say(`   twilio api:core:keys:remove --sid ${existingSk}`, onLog);
    onDone(false); return;
  }

  say("   Creating a restricted read-only API key…", onLog);
  // v1 Keys Policy format: { "allow": ["/twilio/.../read", ...] }
  const policy = JSON.stringify({ allow: readOnlyAllowList() });
  const keyJson = capture("twilio", [
    "api:iam:v1:keys:create",
    "--account-sid", accountSid,
    "--friendly-name", "twilioworld-toolkit",
    "--key-type", "restricted",
    "--policy", policy,
    "-o", "json",
  ], authEnv);
  try {
    const parsed = JSON.parse(keyJson || "[]");
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    // Surface Twilio API errors (e.g. 70002/70004/20003) instead of a generic message.
    if (entry?.status && entry?.status >= 400) {
      err(`Twilio API error ${entry.code ?? entry.status}: ${entry.message ?? "request failed"}`, onLog);
      if (entry.more_info) say(`   ${entry.more_info}`, onLog);
      if (entry.code === 70002) {
        say("   A permission in the policy was rejected. Remove any partially-created", onLog);
        say("   'twilioworld-toolkit' key in the Console and retry, or create the key there:", onLog);
        say("   https://www.twilio.com/docs/iam/api-keys/keys-in-console", onLog);
      } else {
        say("   The Auth Token must be correct and belong to this Account SID.", onLog);
      }
      onDone(false); return;
    }
    const keySid = entry?.sid ?? "";
    const secret = entry?.secret ?? "";
    if (!keySid || !secret) {
      err("Restricted key creation didn't return a sid/secret.", onLog);
      say("   Create one in the Console instead:", onLog);
      say("   https://www.twilio.com/docs/iam/api-keys/restricted-api-keys", onLog);
      onDone(false); return;
    }
    const creds = `${accountSid}/${keySid}:${secret}`;
    if (!looksLikeMcpCreds(creds)) {
      warn(`Credential shape looked unusual (accountSid=${accountSid.slice(0, 4)}…, keySid=${keySid.slice(0, 4)}…) — proceeding anyway.`, onLog);
    }
    mkdir(CONFIG_DIR, { recursive: true });
    const envFile = pathJoin(CONFIG_DIR, ".env");
    writeFileSync(envFile, `export TWILIO_MCP_CREDS="${creds}"\n`, { mode: 0o600 });
    chmod(envFile, 0o600);
    ok(`Restricted read-only API key created (${keySid})`, onLog);
    ok("Scope: read-only for Messaging (list + fetch messages).", onLog);
    say("   To grant read access to more products, edit the key's permissions", onLog);
    say("   in the Console: https://www.twilio.com/docs/iam/api-keys/keys-in-console", onLog);
    ok(`Saved to ${envFile} — chmod 600, gitignored, never printed here.`, onLog);
    say("   (Your Auth Token was NOT saved — only the read-only key.)", onLog);
    say("", onLog);
    say("To use it, load it in your shell before launching an agent:", onLog);
    say(`   source ${envFile}`, onLog);
    say("Then Configure agent wires the Execute MCP automatically.", onLog);
    onDone(true);
  } catch (e) {
    err(`Couldn't create the restricted key: ${(e as Error).message}`, onLog);
    onDone(false);
  }
}
