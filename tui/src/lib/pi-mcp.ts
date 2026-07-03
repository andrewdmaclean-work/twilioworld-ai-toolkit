// lib/pi-mcp.ts — shared helper for writing Pi MCP config.
// Used by configure-agent.ts and pi.ts.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { addonEnabled } from "./config.ts";
import { DOCS_MCP_URL, TWILIO_MCP_PKG } from "./constants.ts";

export function writePiMcpConfig(piDir: string, mcpCreds = ""): void {
  const docs = addonEnabled("docsMcp");
  const execute = addonEnabled("executeMcp") && Boolean(mcpCreds || process.env.TWILIO_MCP_CREDS);
  if (!docs && !execute) return;

  const servers: Record<string, unknown> = {};
  if (docs) {
    servers["twilio-docs"] = {
      type: "http",
      url: DOCS_MCP_URL,
      lifecycle: "eager",
      directTools: true,
    };
  }
  if (execute) {
    servers["twilio-execute"] = {
      command: "npx",
      args: ["-y", TWILIO_MCP_PKG, "${TWILIO_MCP_CREDS}"],
    };
  }
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, "mcp.json"), JSON.stringify({ mcpServers: servers }, null, 2) + "\n");
}
