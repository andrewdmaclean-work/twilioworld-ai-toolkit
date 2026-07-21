// lib/pi-mcp.ts — shared helper for writing Pi MCP config.
// Used by configure-agent.ts and pi.ts.
//
// Docs MCP is always wired (no auth, no account data). Execute MCP is wired only
// when restricted Twilio API creds are available, so it self-gates on creds
// rather than a separate opt-in toggle.

import { chmodSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { DOCS_MCP_URL, TWILIO_MCP_PKG } from "./constants.ts";

// The Execute MCP loads NO tools unless told which API service(s) to expose
// (see @twilio-alpha/mcp README). Keep this narrow; the key itself remains
// restricted to read-only clue surfaces.
const EXECUTE_SERVICES = "twilio_api_v2010";

export function writePiMcpConfig(piDir: string, mcpCreds = ""): void {
  // Resolve creds from the passed arg OR the environment (loaded from
  // .toolkit/.env at startup) so re-running Configure Agent / launching Pi
  // picks up a key created earlier.
  const creds = mcpCreds || process.env.TWILIO_MCP_CREDS || "";

  const servers: Record<string, unknown> = {
    "twilio-docs": {
      type: "http",
      url: DOCS_MCP_URL,
      lifecycle: "eager",
      // Keep every MCP schema behind the single proxy tool. Even the two Docs
      // tools add unnecessary prompt weight when the proxy already routes them.
      directTools: false,
    },
  };
  if (creds) {
    servers["twilio-execute"] = {
      command: "npx",
      // Inline the resolved creds rather than "${TWILIO_MCP_CREDS}" — the new
      // Pi terminal window may not carry the exported env var reliably, and
      // not all agents expand ${...} in mcp.json args. --services makes the
      // server actually expose tools (it exposes none by default).
      args: ["-y", TWILIO_MCP_PKG, creds, "--services", EXECUTE_SERVICES],
      lifecycle: "eager",
      // Execute currently exposes ~200 tools and ~110K tokens of schemas.
      // Proxy-only mode keeps those schemas out of every model request.
      directTools: false,
    };
  }
  mkdirSync(piDir, { recursive: true });
  const dest = join(piDir, "mcp.json");
  writeFileSync(dest, JSON.stringify({ settings: { toolPrefix: "none" }, mcpServers: servers }, null, 2) + "\n");
  // mcp.json now embeds the API secret when Execute is wired — restrict it.
  if (creds) { try { chmodSync(dest, 0o600); } catch { /* best-effort */ } }
}
