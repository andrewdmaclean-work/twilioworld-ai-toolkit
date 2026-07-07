// lib/configure-agent.ts — agent-specific setup.
// Drives agent-specific setup. The chosen agent string and optional
// mcpCreds are passed in; everything runs via runStreaming.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { capture, have, openInNewWindow, runStreaming, type LogFn } from "./exec.ts";
import { CONFIG_DIR, DOCS_MCP_URL, PI_AGENT_PKG, ROOT, TWILIO_MCP_PKG } from "./constants.ts";
import { launchPi } from "./pi.ts";
import { pathNodeVersion, supportsPiNode } from "./node-version.ts";

function ok(msg: string, onLog: LogFn) { onLog(`✓ ${msg}`, "stdout"); }
function warn(msg: string, onLog: LogFn) { onLog(`⚠  ${msg}`, "stderr"); }
function err(msg: string, onLog: LogFn) { onLog(`✗ ${msg}`, "stderr"); }
function say(msg: string, onLog: LogFn) { onLog(msg, "stdout"); }

function printExecuteOneliner(mcpCreds: string, onLog: LogFn) {
  if (mcpCreds) {
    say(`       npx -y ${TWILIO_MCP_PKG} "${mcpCreds}"`, onLog);
  } else {
    say(`       npx -y ${TWILIO_MCP_PKG} "ACxxx/SKxxx:secret"   (add your creds)`, onLog);
  }
}

/** Try each installer in order (brew, then npm, then a curl|sh script) until
 *  one succeeds. Used by the Claude Code / Codex / Cursor branches below —
 *  mirrors the fallback chain Pi and OpenCode already use. */
async function installVia(opts: {
  brew?: string[];
  npm?: string[];
  curl?: string;
  onLog: LogFn;
}): Promise<boolean> {
  const { brew, npm, curl, onLog } = opts;
  if (brew && have("brew")) {
    const res = await runStreaming("brew", brew, { cwd: ROOT, onLog });
    if (res.ok) return true;
    warn("brew install failed — trying the next method…", onLog);
  }
  if (npm && have("npm")) {
    const res = await runStreaming("npm", npm, { cwd: ROOT, onLog });
    if (res.ok) return true;
    warn("npm install failed — trying the next method…", onLog);
  }
  if (curl && have("curl")) {
    const res = await runStreaming("bash", ["-c", curl], { cwd: ROOT, onLog });
    if (res.ok) return true;
  }
  return false;
}

/** Best-effort `<cmd> mcp add ...` — logged but never fatal: an agent's MCP
 *  subcommand syntax can shift between versions, and failing to wire an MCP
 *  server shouldn't block install + launch. */
async function tryMcpAdd(command: string, args: string[], onLog: LogFn): Promise<void> {
  const res = await runStreaming(command, args, { cwd: ROOT, onLog });
  if (!res.ok) warn(`Could not run "${command} ${args.join(" ")}" — you can run it yourself later.`, onLog);
}

// ── Unified agent wiring ─────────────────────────────────────────────────
// Every non-Pi agent (Claude Code, Codex, Cursor, OpenCode, GitHub Copilot)
// follows the exact same shape, so the flow is identical no matter which
// one you pick:
//
//   1. install the CLI (installVia brew→npm→curl), abort on failure
//   2. wire Twilio Skills
//   3. wire the Docs MCP
//   4. wire the Execute MCP
//   5. launch the CLI in a new terminal window
//
// The only per-agent differences are DATA, captured in AgentSpec below:
// the binary name, install sources, docs URL, and the exact MCP-wiring /
// Skills steps (each CLI genuinely has different syntax — Claude has
// plugins + `mcp add`, Codex has `mcp add` with `--url`, Cursor/Copilot
// wire MCP interactively, etc). Pi is intentionally NOT in this table: it's
// a local agent that needs the model and launches via launchPi().

interface AgentSpec {
  /** Display name used in log messages. */
  label: string;
  /** Binary probed with have() and launched with openInNewWindow(). */
  bin: string;
  /** Install sources for installVia() (brew→npm→curl, first that works). */
  install: { brew?: string[]; npm?: string[]; curl?: string };
  /** Docs link shown if every install method fails. */
  docsUrl: string;
  /** First-run note appended to the successful-launch message (e.g. sign in / login). */
  firstRunHint: string;
  /** Wire Twilio Skills into this agent (best-effort; may just print steps). */
  wireSkills?: (onLog: LogFn) => Promise<void> | void;
  /** Wire the Docs MCP (best-effort; may just print steps). */
  wireDocsMcp?: (onLog: LogFn) => Promise<void> | void;
  /** Wire the Execute MCP (best-effort; may just print steps). */
  wireExecuteMcp?: (mcpCreds: string, onLog: LogFn) => Promise<void> | void;
}

/** Runs the identical install → wire → launch sequence for any AgentSpec. */
async function configureStandardAgent(
  spec: AgentSpec,
  mcpCreds: string,
  onLog: LogFn,
  onDone: (ok: boolean) => void,
): Promise<void> {
  // 1. Install (skip if already present, abort on failure).
  if (have(spec.bin)) {
    ok(`${spec.label} already installed  ${capture(spec.bin, ["--version"])}`, onLog);
  } else {
    warn(`${spec.label} not found — installing…`, onLog);
    const installed = await installVia({ ...spec.install, onLog });
    if (installed) ok(`${spec.label} installed`, onLog);
    else { err(`Could not install ${spec.label} — see ${spec.docsUrl}`, onLog); onDone(false); return; }
  }

  // 2–4. Wire Skills + Docs MCP always (no auth, no risk). Wire the
  // Execute MCP only when creds are available (it can call live APIs).
  // Resolve creds from the passed arg OR the environment (loaded from
  // .toolkit/.env at startup) so re-running Configure Agent picks up a key
  // created earlier — not just one created in this same run.
  const effectiveCreds = mcpCreds || process.env.TWILIO_MCP_CREDS || "";
  await spec.wireSkills?.(onLog);
  await spec.wireDocsMcp?.(onLog);
  if (effectiveCreds) await spec.wireExecuteMcp?.(effectiveCreds, onLog);

  // 5. Launch in a new terminal window.
  say("", onLog);
  const launch = openInNewWindow(spec.bin, [], { cwd: ROOT });
  if (launch.ok) ok(`${spec.label} opened in a new terminal window — ${spec.firstRunHint}`, onLog);
  else { err(launch.error ?? "Could not open a new terminal window.", onLog); say(`   Run it yourself: cd ${ROOT} && ${spec.bin}`, onLog); }

  onDone(true);
}


// opencode.json is a tracked file, committed with sensible static defaults
// (twilio-docs on, twilio-execute off — matching the toolkit's own
// defaults). This never writes to it; if the user's add-on choices
// differ from those committed defaults, it prints an OPENCODE_CONFIG_CONTENT
// override instead — the officially supported "final local-scope merge"
// env var — so local machine state never lands in a tracked file.
function configureOpencodeMcpSelection(onLog: LogFn) {
  const ocJson = join(ROOT, "opencode.json");
  if (!existsSync(ocJson)) { warn("opencode.json not found — skipping MCP check", onLog); return; }

  let committed: { mcp?: Record<string, { enabled?: boolean }> } = {};
  try {
    committed = JSON.parse(readFileSync(ocJson, "utf8"));
  } catch (e) {
    warn(`Could not read opencode.json: ${e}`, onLog);
    return;
  }

  const wanted: Record<string, boolean> = {
    "twilio-docs": true,
    "twilio-execute": Boolean(process.env.TWILIO_MCP_CREDS),
  };
  const drift = Object.entries(wanted).filter(
    ([name, on]) => (committed.mcp?.[name]?.enabled ?? false) !== on,
  );

  if (!drift.length) {
    ok("opencode.json's committed MCP defaults already match your selected choices", onLog);
    return;
  }

  const override = {
    $schema: "https://opencode.ai/config.json",
    mcp: Object.fromEntries(drift.map(([name, on]) => [name, { enabled: on }])),
  };
  warn(`Your add-on choices differ from opencode.json's committed defaults (${drift.map(([n]) => n).join(", ")}).`, onLog);
  say("   opencode.json is a tracked file — this toolkit never modifies it.", onLog);
  say("   Override at launch time instead:", onLog);
  say(`       export OPENCODE_CONFIG_CONTENT='${JSON.stringify(override)}'`, onLog);
  say(`   Persist it: echo 'export OPENCODE_CONFIG_CONTENT=...' >> ${join(CONFIG_DIR, ".env")} && source ${join(CONFIG_DIR, ".env")}`, onLog);
}

export async function configureAgent(opts: {
  agent: string;
  mcpCreds?: string;
  onLog: LogFn;
  onDone: (ok: boolean) => void;
}): Promise<void> {
  const { agent, mcpCreds = "", onLog, onDone } = opts;

  if (agent.startsWith("Pi")) {
    // ── Pi ───────────────────────────────────────────────────────────
    const nodeInfo = pathNodeVersion();
    if (!supportsPiNode(nodeInfo)) {
      warn(`Pi requires Node >= 22.19.0 on PATH — node is ${nodeInfo?.raw ?? "not found"}.`, onLog);
      warn("Run `nvm use 22` then re-run Configure agent.", onLog);
      onDone(false);
      return;
    }

    if (!have("pi")) {
      warn("Pi not found — installing…", onLog);
      let installed = false;
      if (have("npm")) {
        const res = await runStreaming("npm", ["install", "-g", "--ignore-scripts", PI_AGENT_PKG], { cwd: ROOT, onLog });
        installed = res.ok;
        if (!installed) {
          warn("npm install failed — trying install script…", onLog);
        }
      }
      if (!installed && have("curl")) {
        const res = await runStreaming("bash", ["-c", "curl -fsSL https://pi.dev/install.sh | sh"], { cwd: ROOT, onLog });
        installed = res.ok;
      }
      if (installed) ok("Pi installed", onLog);
      else { err("Could not install Pi — see https://pi.dev", onLog); onDone(false); return; }
    } else {
      ok(`Pi already installed  ${capture("pi", ["--version"])}`, onLog);
    }

    // Capabilities + launch — shared with the menu's own Pi path
    // (lib/pi.ts) so there's exactly one place that knows how to wire
    // Skills/MCP/model config and open Pi in a new terminal window.
    if (mcpCreds) {
      say("", onLog);
      say("   Exporting creds so the Execute MCP can authenticate:", onLog);
      say(`       export TWILIO_MCP_CREDS="${mcpCreds}"`, onLog);
    }
    await launchPi({ onLog });
    warn("Local 2B model: keep the tool set small. For heavy MCP use, switch to a cloud /model inside Pi.", onLog);

  } else if (agent === "OpenCode") {
    // OpenCode is config-file driven for MCP (opencode.json), not `mcp add`,
    // so its wireDocsMcp/wireExecuteMcp print the tracked-file override
    // guidance via configureOpencodeMcpSelection rather than run a subcommand.
    await configureStandardAgent(
      {
        label: "OpenCode",
        bin: "opencode",
        install: { brew: ["install", "anomalyco/tap/opencode"], npm: ["install", "-g", "opencode-ai"] },
        docsUrl: "https://opencode.ai/docs",
        firstRunHint: "run /connect there to pick a model (Anthropic, OpenAI, or Zen).",
        wireSkills: () => ok("Twilio Skills use the Agent Skills standard — OpenCode reads them from ~/.agents/skills.", onLog),
        wireDocsMcp: (l) => configureOpencodeMcpSelection(l),
        wireExecuteMcp: (creds, l) => {
          if (creds) { say("   To enable the Execute MCP, launch with your creds:", l); say(`       TWILIO_MCP_CREDS="${creds}" opencode`, l); }
          else { say("   Add the Execute MCP once you have creds:", l); printExecuteOneliner(creds, l); }
        },
      },
      mcpCreds, onLog, onDone,
    );
    return;

  } else if (agent === "Claude Code") {
    await configureStandardAgent(
      {
        label: "Claude Code",
        bin: "claude",
        install: { brew: ["install", "--cask", "claude-code"], npm: ["install", "-g", "@anthropic-ai/claude-code"], curl: "curl -fsSL https://claude.ai/install.sh | bash" },
        docsUrl: "https://code.claude.com/docs/en/quickstart",
        firstRunHint: "sign in there if it's your first run.",
        wireSkills: async (l) => {
          say("   Installing the Twilio developer kit plugin…", l);
          await tryMcpAdd("claude", ["plugin", "marketplace", "add", "https://github.com/twilio/ai"], l);
          await tryMcpAdd("claude", ["plugin", "install", "twilio-developer-kit@twilio"], l);
        },
        wireDocsMcp: async (l) => {
          say("   Adding the Docs MCP…", l);
          await tryMcpAdd("claude", ["mcp", "add", "twilio-docs", "--transport", "http", DOCS_MCP_URL], l);
        },
        wireExecuteMcp: async (creds, l) => {
          if (creds) { say("   Adding the Execute MCP…", l); await tryMcpAdd("claude", ["mcp", "add", "twilio-execute", "--", "npx", "-y", TWILIO_MCP_PKG, creds], l); }
          else { say("   Add the Execute MCP once you have creds:", l); printExecuteOneliner(creds, l); say(`       claude mcp add twilio-execute -- npx -y ${TWILIO_MCP_PKG} "ACxxx/SKxxx:secret"`, l); }
        },
      },
      mcpCreds, onLog, onDone,
    );
    return;

  } else if (agent === "Cursor") {
    await configureStandardAgent(
      {
        label: "Cursor CLI",
        bin: "cursor-agent",
        install: { brew: ["install", "--cask", "cursor-cli"], curl: "curl https://cursor.com/install -fsS | bash" },
        docsUrl: "https://cursor.com/docs/cli",
        firstRunHint: "sign in there if it's your first run.",
        wireSkills: (l) => { say("   In Cursor Composer or the CLI, install the plugin:", l); say("       /add-plugin twilio-developer-kit", l); },
        wireDocsMcp: (l) => { say("   Add the Docs MCP under Cursor Settings > MCP:", l); say(`       type: http   url: ${DOCS_MCP_URL}`, l); },
        wireExecuteMcp: (creds, l) => { say("   Add the Execute MCP under Cursor Settings > MCP, or run:", l); printExecuteOneliner(creds, l); },
      },
      mcpCreds, onLog, onDone,
    );
    return;

  } else if (agent === "Codex") {
    await configureStandardAgent(
      {
        label: "Codex",
        bin: "codex",
        install: { brew: ["install", "codex"], npm: ["install", "-g", "@openai/codex"], curl: "curl -fsSL https://chatgpt.com/codex/install.sh | sh" },
        docsUrl: "https://developers.openai.com/codex/cli",
        firstRunHint: "sign in there if it's your first run.",
        wireSkills: (l) => {
          say("   In Codex, open Plugins and install \"Twilio developer kit\" (Codex plugin", l);
          say("   marketplaces aren't auto-wired by this toolkit yet).", l);
          say("       /plugins", l);
        },
        wireDocsMcp: async (l) => { say("   Adding the Docs MCP…", l); await tryMcpAdd("codex", ["mcp", "add", "twilio-docs", "--url", DOCS_MCP_URL], l); },
        wireExecuteMcp: async (creds, l) => {
          if (creds) { say("   Adding the Execute MCP…", l); await tryMcpAdd("codex", ["mcp", "add", "twilio-execute", "--", "npx", "-y", TWILIO_MCP_PKG, creds], l); }
          else { say("   Add the Execute MCP once you have creds:", l); printExecuteOneliner(creds, l); say(`       codex mcp add twilio-execute -- npx -y ${TWILIO_MCP_PKG} "ACxxx/SKxxx:secret"`, l); }
        },
      },
      mcpCreds, onLog, onDone,
    );
    return;

  } else if (agent === "GitHub Copilot") {
    await configureStandardAgent(
      {
        label: "GitHub Copilot CLI",
        bin: "copilot",
        install: { brew: ["install", "--cask", "copilot-cli"], npm: ["install", "-g", "@github/copilot"], curl: "curl -fsSL https://gh.io/copilot-install | bash" },
        docsUrl: "https://docs.github.com/copilot/how-tos/set-up/install-copilot-cli",
        firstRunHint: "run /login there if it's your first run.",
        wireSkills: (l) => ok("Twilio Skills use the Agent Skills standard — Copilot CLI reads them from ~/.agents/skills.", l),
        // Copilot manages MCP interactively via /mcp (no stable subcommand).
        wireDocsMcp: (l) => { say("   Add the Docs MCP inside Copilot with the /mcp command:", l); say(`       name: twilio-docs   type: http   url: ${DOCS_MCP_URL}`, l); },
        wireExecuteMcp: (creds, l) => { say("   Add the Execute MCP inside Copilot with the /mcp command (local/stdio):", l); printExecuteOneliner(creds, l); },
      },
      mcpCreds, onLog, onDone,
    );
    return;

  } else {
    // Other / Bring my own
    say("=== Bring Your Own Agent ===", onLog);
    say("Everything is open-standard (MCP + Agent Skills):", onLog);
    say("", onLog);
    say(`  Docs MCP (HTTP, no auth):  ${DOCS_MCP_URL}`, onLog);
    say("", onLog);
    say("  Execute MCP (experimental, stdio):", onLog);
    printExecuteOneliner(mcpCreds, onLog);
    say("", onLog);
    say("  Skills (Agent Skills standard) — install globally:", onLog);
    say(`      cp -r "${join(ROOT, "vendor", "twilio-ai", "skills")}" ~/.agents/skills/`, onLog);
    say("", onLog);
    say("  Local model (OpenAI-compatible):", onLog);
    say("      http://127.0.0.1:8080/v1   (launch from menu → Chat or Model server)", onLog);
    say("", onLog);
    say("  Works with Copilot, Gemini CLI, JetBrains Junie + 30 more.", onLog);
  }

  onDone(true);
}
