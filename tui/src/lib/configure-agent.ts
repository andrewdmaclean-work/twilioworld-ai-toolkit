// lib/configure-agent.ts — agent-specific setup.
// Drives agent-specific setup. The chosen agent string and optional
// mcpCreds are passed in; everything runs via runStreaming.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { capture, have, openInNewWindow, runStreaming, type LogFn } from "./exec.ts";
import { addonEnabled } from "./config.ts";
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
    "twilio-docs": addonEnabled("docsMcp"),
    "twilio-execute": addonEnabled("executeMcp"),
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
    configureOpencodeMcpSelection(onLog);
    if (have("opencode")) {
      ok(`OpenCode already installed  ${capture("opencode", ["--version"])}`, onLog);
    } else {
      warn("OpenCode not found — installing…", onLog);
      let installed = false;
      if (have("brew")) {
        const res = await runStreaming("brew", ["install", "anomalyco/tap/opencode"], { cwd: ROOT, onLog });
        installed = res.ok;
      }
      if (!installed && have("npm")) {
        const res = await runStreaming("npm", ["install", "-g", "opencode-ai"], { cwd: ROOT, onLog });
        installed = res.ok;
      }
      if (installed) ok("OpenCode installed", onLog);
      else err("Could not install OpenCode — see https://opencode.ai/docs", onLog);
    }
    say("", onLog);
    say("   Launch from this directory:", onLog);
    say(`       cd ${ROOT} && opencode`, onLog);
    say("", onLog);
    warn("Pick a real model for OpenCode — run /connect inside OpenCode and choose Anthropic, OpenAI, or Zen.", onLog);
    if (mcpCreds) {
      say("", onLog);
      say("   To enable the Execute MCP, launch with your creds:", onLog);
      say(`       TWILIO_MCP_CREDS="${mcpCreds}" opencode`, onLog);
    }

  } else if (agent === "Claude Code") {
    if (have("claude")) {
      ok(`Claude Code already installed  ${capture("claude", ["--version"])}`, onLog);
    } else {
      warn("Claude Code not found — installing…", onLog);
      const installed = await installVia({
        brew: ["install", "--cask", "claude-code"],
        npm: ["install", "-g", "@anthropic-ai/claude-code"],
        curl: "curl -fsSL https://claude.ai/install.sh | bash",
        onLog,
      });
      if (installed) ok("Claude Code installed", onLog);
      else { err("Could not install Claude Code — see https://code.claude.com/docs/en/quickstart", onLog); onDone(false); return; }
    }

    if (addonEnabled("twilioSkills")) {
      say("   Installing the Twilio developer kit plugin…", onLog);
      await tryMcpAdd("claude", ["plugin", "marketplace", "add", "https://github.com/twilio/ai"], onLog);
      await tryMcpAdd("claude", ["plugin", "install", "twilio-developer-kit@twilio"], onLog);
    }
    if (addonEnabled("docsMcp")) {
      say("   Adding the Docs MCP…", onLog);
      await tryMcpAdd("claude", ["mcp", "add", "twilio-docs", "--transport", "http", DOCS_MCP_URL], onLog);
    }
    if (addonEnabled("executeMcp") && mcpCreds) {
      say("   Adding the Execute MCP…", onLog);
      await tryMcpAdd("claude", ["mcp", "add", "twilio-execute", "--", "npx", "-y", TWILIO_MCP_PKG, mcpCreds], onLog);
    } else if (addonEnabled("executeMcp")) {
      say("   Add the Execute MCP once you have creds:", onLog);
      printExecuteOneliner(mcpCreds, onLog);
      say(`       claude mcp add twilio-execute -- npx -y ${TWILIO_MCP_PKG} "ACxxx/SKxxx:secret"`, onLog);
    }

    say("", onLog);
    const claudeLaunch = openInNewWindow("claude", [], { cwd: ROOT });
    if (claudeLaunch.ok) ok("Claude Code opened in a new terminal window — sign in there if it's your first run.", onLog);
    else { err(claudeLaunch.error ?? "Could not open a new terminal window.", onLog); say(`   Run it yourself: cd ${ROOT} && claude`, onLog); }

  } else if (agent === "Cursor") {
    if (have("cursor-agent")) {
      ok(`Cursor CLI already installed  ${capture("cursor-agent", ["--version"])}`, onLog);
    } else {
      warn("Cursor CLI (cursor-agent) not found — installing…", onLog);
      const installed = await installVia({
        brew: ["install", "--cask", "cursor-cli"],
        curl: "curl https://cursor.com/install -fsS | bash",
        onLog,
      });
      if (installed) ok("Cursor CLI installed", onLog);
      else { err("Could not install the Cursor CLI — see https://cursor.com/docs/cli", onLog); onDone(false); return; }
    }

    say("   In Cursor Composer or the CLI, install the plugin:", onLog);
    say("       /add-plugin twilio-developer-kit", onLog);
    say("   Add Execute MCP under Cursor Settings > MCP, or run:", onLog);
    printExecuteOneliner(mcpCreds, onLog);

    say("", onLog);
    const cursorLaunch = openInNewWindow("cursor-agent", [], { cwd: ROOT });
    if (cursorLaunch.ok) ok("Cursor CLI opened in a new terminal window — sign in there if it's your first run.", onLog);
    else { err(cursorLaunch.error ?? "Could not open a new terminal window.", onLog); say(`   Run it yourself: cd ${ROOT} && cursor-agent`, onLog); }

  } else if (agent === "Codex") {
    if (have("codex")) {
      ok(`Codex already installed  ${capture("codex", ["--version"])}`, onLog);
    } else {
      warn("Codex not found — installing…", onLog);
      const installed = await installVia({
        brew: ["install", "codex"],
        npm: ["install", "-g", "@openai/codex"],
        curl: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
        onLog,
      });
      if (installed) ok("Codex installed", onLog);
      else { err("Could not install Codex — see https://developers.openai.com/codex/cli", onLog); onDone(false); return; }
    }

    if (addonEnabled("twilioSkills")) {
      say("   In Codex, open Plugins and install \"Twilio developer kit\" (Codex plugin", onLog);
      say("   marketplaces aren't auto-wired by this toolkit yet).", onLog);
      say("       /plugins", onLog);
    }
    if (addonEnabled("docsMcp")) {
      say("   Adding the Docs MCP…", onLog);
      await tryMcpAdd("codex", ["mcp", "add", "twilio-docs", "--url", DOCS_MCP_URL], onLog);
    }
    if (addonEnabled("executeMcp") && mcpCreds) {
      say("   Adding the Execute MCP…", onLog);
      await tryMcpAdd("codex", ["mcp", "add", "twilio-execute", "--", "npx", "-y", TWILIO_MCP_PKG, mcpCreds], onLog);
    } else if (addonEnabled("executeMcp")) {
      say("   Add the Execute MCP once you have creds:", onLog);
      printExecuteOneliner(mcpCreds, onLog);
      say(`       codex mcp add twilio-execute -- npx -y ${TWILIO_MCP_PKG} "ACxxx/SKxxx:secret"`, onLog);
    }

    say("", onLog);
    const codexLaunch = openInNewWindow("codex", [], { cwd: ROOT });
    if (codexLaunch.ok) ok("Codex opened in a new terminal window — sign in there if it's your first run.", onLog);
    else { err(codexLaunch.error ?? "Could not open a new terminal window.", onLog); say(`   Run it yourself: cd ${ROOT} && codex`, onLog); }

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
