#!/usr/bin/env node
//
// build-system-prompt.js — generate a compact Twilio system prompt from the
// Skills index, written to models/system-prompt.txt for llamafile to load.
//
// Run automatically by start-model.sh. Safe to run standalone.

"use strict";
const { readFileSync, readdirSync, statSync, existsSync, writeFileSync } = require("fs");
const { join } = require("path");

const ROOT = __dirname;
const skillsDir = join(ROOT, "vendor", "twilio-ai", "skills");
const routingPromptFile = join(ROOT, ".pi", "routing-prompt.md");
const out = join(ROOT, "models", "system-prompt.txt");
const useSkills = process.env.TOOLKIT_USE_SKILLS !== "0";

let lines = [];
if (useSkills && existsSync(skillsDir)) {
  for (const vendor of readdirSync(skillsDir)) {
    const vendorDir = join(skillsDir, vendor);
    if (!statSync(vendorDir).isDirectory()) continue;
    for (const skill of readdirSync(vendorDir)) {
      const f = join(vendorDir, skill, "SKILL.md");
      if (!existsSync(f)) continue;
      const fm = readFileSync(f, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const desc = fm
        .match(/^description:\s*[>|]?\n?([\s\S]*?)(?=\n\S|\n?$)/m)?.[1]
        ?.split("\n").map((l) => l.trim()).filter(Boolean).join(" ").slice(0, 120);
      if (name && desc) lines.push(`- ${name}: ${desc}`);
    }
  }
}

const prompt = [
  "You are a Twilio expert assistant at a developer escape room.",
  "Help developers solve challenges using Twilio APIs. Be concise. Show working code.",
  "",
  existsSync(routingPromptFile) ? readFileSync(routingPromptFile, "utf8").trim() : "",
  "",
  useSkills
    ? [
        "You have an index of Twilio Skills below (name + summary). When your answer draws",
        "on one or more of them, you MUST end your reply with a line of the form:",
        "  Skills used: <skill-name>, <skill-name>",
        "If no skill applied, end with: Skills used: none",
        "",
        lines.length
          ? `Available Twilio skills (${lines.length}):\n${lines.join("\n")}`
          : "(Twilio skills index unavailable — run: git submodule update --init)",
      ].join("\n")
    : "Twilio Skills are not loaded in this session. End Twilio replies with: Skills used: none",
].join("\n");

writeFileSync(out, prompt);
process.stdout.write(`${out} (${lines.length} skills, ${prompt.length} chars)\n`);
