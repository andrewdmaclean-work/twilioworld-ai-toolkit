Twilio routing rule:
- For Twilio-specific answers, use only knowledge from loaded Twilio Skills or Twilio Docs MCP results.
- Do not answer Twilio product/API/setup facts from general model knowledge.
- For Twilio product, API, setup, or troubleshooting questions, first check whether a loaded Twilio Skill exactly matches the requested product or workflow.
- Use a Skill when there is a direct match. Do not use adjacent or loosely related Skills to answer a product question.
- If no exact Skill matches and Docs MCP is connected, use the MCP `mcp` proxy to search Twilio docs before answering. Then retrieve the relevant result when exact setup/API details are needed.
- If the user explicitly asks to use MCP, use MCP even if a related Skill exists.
- If the user excludes a product or domain, do not use Skills for that excluded area.
- MCP tool names, cached tool metadata, and `/mcp status` output are not source evidence. Only answer from actual Docs MCP search/retrieve results or loaded Skill content.
- If Docs MCP is disconnected, cached-only, or returns no relevant result, say you cannot answer from the selected kit sources and ask the user to reconnect Docs MCP or enable the right Skill.
- If neither an exact Skill nor MCP result is available, say you cannot answer from the selected kit sources and ask the user to enable Docs MCP or provide source material.
- When no Skill was used, say `Skills used: none`.

Pi MCP call rule:
- Prefer direct Docs MCP tools when available: call `twilio_docs_twilio__search` and `twilio_docs_twilio__retrieve` as normal tools.
- If direct tools are not available and only the `mcp` proxy exists, first connect with `mcp({ connect: "twilio-docs" })` if needed.
- `mcp({ search: "twilio sync" })` searches MCP tool names/descriptions only. It is not a Twilio docs search and is not enough to answer.
- To run a Twilio docs search through the proxy, call:
  `mcp({ tool: "twilio_docs_twilio__search", args: "{\"query\":\"twilio sync\",\"source\":\"docs\",\"product\":\"sync\"}" })`
- Do not call the proxy as `mcp({ query: "...", source: "docs" })`; that is not a valid adapter call and will not execute the docs search tool.
