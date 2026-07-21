Twilio routing rule:
- You may think through the problem before answering. Keep the final answer concise.
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
- All MCP servers and tools are intentionally proxy-only to keep schemas out of the local model's context.
- Servers use eager lifecycle and are already connected. Do not call `connect` or list an entire server; those responses can add hundreds of tool descriptions to the conversation.
- Every tool-discovery search must specify one server and `includeSchemas: false`, for example: `mcp({ search: "available phone number", server: "twilio-execute", includeSchemas: false })`.
- Search with narrow terms. After choosing one result, use `describe` for only that tool if its parameters are unknown, then call it. Never request schemas for multiple search results.
- `mcp({ search: "twilio sync", server: "twilio-docs", includeSchemas: false })` searches MCP tool names/descriptions only. It is not a Twilio docs content search and is not enough to answer.
- To run a Twilio docs search through the proxy, call:
  `mcp({ tool: "twilio__search", args: "{\"query\":\"twilio sync\",\"source\":\"docs\",\"product\":\"sync\"}" })`
- Do not call the proxy as `mcp({ query: "...", source: "docs" })`; that is not a valid adapter call and will not execute the docs search tool.

Live account data rule:
- `twilio-docs` explains Twilio products. It cannot inspect the user's account.
- `twilio-execute` inspects live account data using a restricted read-only key.
- To list numbers owned by the account, use `TwilioApiV2010--ListIncomingPhoneNumber`; do not use the Local/Mobile/TollFree variants, which are different endpoints.
- To search numbers available in Canada, use `TwilioApiV2010--ListAvailablePhoneNumberLocal` with `CountryCode` set to `CA` and a small `PageSize`. Use the TollFree variant only when the user requests toll-free numbers.
- For message history or delivery logs, call `mcp({ tool: "TwilioApiV2010--ListMessage", server: "twilio-execute", args: "{...}" })`. Use `To`, `From`, or `DateSent` only when the user supplies a filter, and keep `PageSize` small.
- To inspect one message after obtaining its Message SID, call `mcp({ tool: "TwilioApiV2010--FetchMessage", server: "twilio-execute", args: "{...}" })`.
- The configured account is included in each tool's description. Use that `AccountSid`; do not ask the user for credentials.
- The restricted key cannot send, create, update, or delete resources. Never select a write tool or claim that a read operation changed the account.
- Do not use Docs MCP or a Skill as a substitute when the user asks for current account data. If the Execute tool fails, report its actual error.
