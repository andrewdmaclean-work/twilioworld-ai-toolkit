import { readFileSync, readdirSync, existsSync } from "fs";
import { join, relative } from "path";
import { readConfig } from "./config.ts";
import { DOCS_MCP_URL, SKILLS_DIR } from "./constants.ts";
import { readStatusAsync } from "../status.ts";

export interface ToolCall {
  id: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_toolkit_status",
      description: "Return current TwilioWorld toolkit status, local model, Pi, Node, Twilio CLI, and selected add-on status.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_addon_config",
      description: "Return the selected TwilioWorld install choices from .toolkit/config.json or defaults.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_twilio_skills",
      description: "List all available Twilio Skill files currently included in the toolkit.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of skill paths to return. Defaults to all skills.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_twilio_skills",
      description: "Search every local Twilio Skill by path and markdown content. Use this before answering Twilio questions from local Skills.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query, product, API, or workflow name.",
          },
          limit: {
            type: "number",
            description: "Maximum matches to return. Defaults to 8.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_twilio_skill",
      description: "Read a local Twilio Skill markdown file by path. Use after list_twilio_skills or search_twilio_skills.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Skill path relative to vendor/twilio-ai/skills, for example twilio/twilio-send-message/SKILL.md.",
          },
          max_chars: {
            type: "number",
            description: "Maximum characters to return. Defaults to 12000.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_twilio_docs_mcp",
      description: "Search live Twilio documentation through the configured Twilio Docs MCP server. Use when local Skills are missing or the user asks for current docs.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Twilio docs search query.",
          },
          product: {
            type: "string",
            description: "Optional Twilio product filter such as messaging, voice, verify, conversations, sendgrid.",
          },
          source: {
            type: "string",
            enum: ["docs", "api", "all"],
            description: "Search source. Use docs for guides, api for API operations, all when unsure. Defaults to all.",
          },
          limit: {
            type: "number",
            description: "Maximum results to return. Defaults to 5, max 10.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retrieve_twilio_doc_mcp",
      description: "Retrieve a Twilio documentation result through the configured Twilio Docs MCP server. Pass the URL, id, or result object returned by search_twilio_docs_mcp.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "One or more id values copied exactly from search_twilio_docs_mcp results.",
          },
          fields: {
            type: "array",
            items: { type: "string", enum: ["request_body", "response_fields"] },
            description: "Optional schema fields to retrieve for API operation results.",
          },
        },
        required: ["ids"],
        additionalProperties: true,
      },
    },
  },
] as const;

function listSkillFiles(dir = SKILLS_DIR, limit = Number.POSITIVE_INFINITY): string[] {
  const out: string[] = [];
  function walk(current: string): void {
    if (out.length >= limit || !existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (out.length >= limit) return;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "SKILL.md") {
        out.push(relative(SKILLS_DIR, full));
      }
    }
  }
  walk(dir);
  return out;
}

function safeSkillPath(path: string): string | null {
  const clean = path.replace(/^vendor\/twilio-ai\/skills\//, "").replace(/^\/+/, "");
  if (!clean || clean.includes("..") || !clean.endsWith("SKILL.md")) return null;
  const full = join(SKILLS_DIR, clean);
  if (!existsSync(full)) return null;
  return full;
}

function skillExcerpt(text: string, query: string, chars = 600): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, chars);
  const start = Math.max(0, idx - Math.floor(chars / 3));
  return text.slice(start, start + chars);
}

function searchSkills(query: string, limit = 8): Array<{ path: string; score: number; excerpt: string }> {
  const stop = new Set(["twilio", "tell", "about", "what", "how", "use", "using", "call", "mcp", "server", "find", "out", "the", "a", "an", "me"]);
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2 && !stop.has(term));
  const activeTerms = terms.length ? terms : query.toLowerCase().split(/\W+/).filter(Boolean);
  const matches: Array<{ path: string; score: number; excerpt: string }> = [];
  for (const path of listSkillFiles()) {
    const full = join(SKILLS_DIR, path);
    const text = readFileSync(full, "utf8");
    const haystack = `${path}\n${text}`.toLowerCase();
    let score = 0;
    for (const term of activeTerms) {
      if (path.toLowerCase().includes(term)) score += 4;
      if (haystack.includes(term)) score += 1;
    }
    if (score > 0) {
      matches.push({ path, score, excerpt: skillExcerpt(text, activeTerms[0] ?? query) });
    }
  }
  return matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

function parseSseOrJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  if (!dataLines.length) return { raw: trimmed };
  return JSON.parse(dataLines[dataLines.length - 1]);
}

async function mcpRequest(method: string, params?: unknown): Promise<unknown> {
  const res = await fetch(DOCS_MCP_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method,
      params,
    }),
  });
  if (!res.ok) throw new Error(`Docs MCP ${method} failed: HTTP ${res.status}`);
  const payload = parseSseOrJson(await res.text()) as { error?: { message?: string }; result?: unknown };
  if (payload.error?.message) throw new Error(payload.error.message);
  return payload.result ?? payload;
}

async function callDocsMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    await mcpRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "twilioworld-toolkit-chat", version: "0.1.0" },
    });
  } catch {
    // Some HTTP MCP deployments are stateless and allow direct tool calls.
  }
  return await mcpRequest("tools/call", { name, arguments: args });
}

function parseArgs(raw = "{}"): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function runChatTool(call: ToolCall): Promise<{ name: string; result: string }> {
  const name = call.function?.name ?? "";
  const args = parseArgs(call.function?.arguments);

  switch (name) {
    case "get_toolkit_status":
      return { name, result: JSON.stringify(await readStatusAsync(), null, 2) };
    case "get_addon_config":
      return { name, result: JSON.stringify(readConfig(), null, 2) };
    case "list_twilio_skills": {
      const rawLimit = typeof args.limit === "number" ? args.limit : Number.POSITIVE_INFINITY;
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : Number.POSITIVE_INFINITY;
      const skills = listSkillFiles(SKILLS_DIR, limit);
      return { name, result: JSON.stringify({ count: skills.length, skills }, null, 2) };
    }
    case "search_twilio_skills": {
      const query = String(args.query ?? "").trim();
      const limit = Math.max(1, Math.min(30, Math.floor(typeof args.limit === "number" ? args.limit : 8)));
      if (!query) return { name, result: JSON.stringify({ error: "query is required" }) };
      return { name, result: JSON.stringify({ query, matches: searchSkills(query, limit) }, null, 2) };
    }
    case "read_twilio_skill": {
      const path = String(args.path ?? "");
      const full = safeSkillPath(path);
      const maxChars = Math.max(1000, Math.min(30000, Math.floor(typeof args.max_chars === "number" ? args.max_chars : 12000)));
      if (!full) return { name, result: JSON.stringify({ error: `Skill not found or unsafe path: ${path}` }) };
      const content = readFileSync(full, "utf8");
      return {
        name,
        result: JSON.stringify({
          path: relative(SKILLS_DIR, full),
          truncated: content.length > maxChars,
          content: content.slice(0, maxChars),
        }, null, 2),
      };
    }
    case "search_twilio_docs_mcp": {
      const query = String(args.query ?? "").trim();
      const product = typeof args.product === "string" && args.product.trim() ? args.product.trim() : undefined;
      if (!query) return { name, result: JSON.stringify({ error: "query is required" }) };
      try {
        const source = ["docs", "api", "all"].includes(String(args.source)) ? String(args.source) : "all";
        const limit = Math.max(1, Math.min(10, Math.floor(typeof args.limit === "number" ? args.limit : 5)));
        const result = await callDocsMcpTool("twilio__search", { query, source, limit, ...(product ? { product } : {}) });
        return { name, result: JSON.stringify(result, null, 2) };
      } catch (e) {
        return { name, result: JSON.stringify({ error: (e as Error).message }) };
      }
    }
    case "retrieve_twilio_doc_mcp": {
      try {
        const result = await callDocsMcpTool("twilio__retrieve", args);
        return { name, result: JSON.stringify(result, null, 2) };
      } catch (e) {
        return { name, result: JSON.stringify({ error: (e as Error).message }) };
      }
    }
    default:
      return { name: name || "unknown", result: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}
