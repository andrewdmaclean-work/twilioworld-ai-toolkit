export const TWILIO_AI_FACTS = [
  "Twilio Skills help agents choose the right product path before code gets written.",
  "The Docs MCP lets agents search Twilio docs and API operations by natural-language query.",
  "Skills and Docs MCP work best together: Skills guide the plan; Docs MCP pulls exact API details.",
  "Execute MCP is intentionally separate from Docs MCP because it can call real Twilio APIs.",
  "The toolkit keeps Execute MCP off by default until you explicitly opt in.",
  "Dev Phone is useful for demos, but it can overwrite number webhooks; use a spare number.",
  "Chat with Twilio uses the local model plus a Twilio-aware system prompt from the skills index.",
  "Agent Skills are plain SKILL.md files, so compatible agents can read them without a custom plugin.",
  "The local model server exposes an OpenAI-compatible endpoint for tools that can use one.",
  "For small local models, focused tool sets are usually better than exposing every possible tool.",
];

export function twilioFactAt(index: number): string {
  return TWILIO_AI_FACTS[index % TWILIO_AI_FACTS.length];
}
