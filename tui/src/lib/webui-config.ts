// lib/webui-config.ts — builds and writes the llama.cpp web UI config.
//
// llamafile's --ui-config-file flag seeds the web UI's default settings at
// server startup (server-side), so the Twilio Docs MCP server and a
// Twilio-aware system message are already configured the first time the
// browser loads the UI — no localStorage injection, no port hijacking.
//
// The MCP server URL points at the local HTTP→HTTPS bridge (mcp-proxy.js),
// not directly at https://mcp.twilio.com/docs, because llamafile 0.10.3 is
// compiled without OpenSSL and its CORS proxy cannot make https:// calls.

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { MCP_PROXY_URL, WEBUI_CONFIG_FILE } from "./constants.ts";

const SYSTEM_MESSAGE = [
  "You are a concise TwilioWorld Agentic Coding Toolkit assistant.",
  "Do not expose chain-of-thought, hidden reasoning, <think> blocks, or internal deliberation.",
  "Answer in plain text only. Do not use Markdown syntax, headings, bullets, tables, code fences, inline code ticks, bold, or italics.",
  "You have tool calling. The Twilio Docs MCP is connected. For Twilio-specific answers, call twilio__search first. If the search result needs more detail, call twilio__retrieve with the id from the search results. If the user explicitly asks for MCP, call twilio__search.",
  "After a tool call, summarize the result plainly and briefly.",
].join(" ");

/** The web UI config object llamafile seeds via --ui-config-file. */
export function buildWebUiConfig(): Record<string, unknown> {
  // mcpServers is a JSON-stringified array inside the config (matches the
  // shape the web UI persists to LlamaUi.config in localStorage).
  const mcpServers = JSON.stringify([
    { id: "twilio-docs-mcp", enabled: true, url: MCP_PROXY_URL, requestTimeoutSeconds: 300 },
  ]);

  return {
    systemMessage: SYSTEM_MESSAGE,
    showSystemMessage: true,
    mcpRequestTimeoutSeconds: 300,
    mcpServers,
  };
}

/** Write ui-config.json to WEBUI_CONFIG_FILE. Returns the path. */
export function writeWebUiConfig(): string {
  mkdirSync(dirname(WEBUI_CONFIG_FILE), { recursive: true });
  writeFileSync(WEBUI_CONFIG_FILE, JSON.stringify(buildWebUiConfig(), null, 2) + "\n");
  return WEBUI_CONFIG_FILE;
}
