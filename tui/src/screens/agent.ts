// screens/agent.ts — native agent selection + in-TUI log for configureAgent().

import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
} from "@opentui/core";
import { configureAgent } from "../lib/configure-agent.ts";
import { THEME } from "../theme.ts";
import { buildEmbeddedRouteChrome, removeAllChildren } from "./chrome.ts";
import { buildLogScreen } from "./log.ts";

const AGENT_OPTIONS = [
  { name: "Claude Code",           description: "Anthropic's CLI agent — toolkit installs + launches it for you", value: "Claude Code" },
  { name: "Codex",                 description: "OpenAI's CLI agent — toolkit installs + launches it for you",   value: "Codex" },
  { name: "Cursor",                description: "Cursor's CLI agent — toolkit installs + launches it for you",   value: "Cursor" },
  { name: "OpenCode",              description: "Open-source coding agent — toolkit installs it for you",        value: "OpenCode" },
  { name: "Pi",                    description: "Local agent — toolkit installs + runs it for you",               value: "Pi (lightweight TUI)" },
  { name: "Other / Bring my own",  description: "Manual MCP wiring instructions",                                 value: "Other / Bring my own" },
];

export function buildAgentScreen(
  renderer: CliRenderer,
  onFinished: () => void,
  onCancel: () => void,
): BoxRenderable {
  const { screen, body } = buildEmbeddedRouteChrome(renderer, {
    id: "agent-screen",
    route: "Dashboard / Configure Agent",
    title: "Configure agent",
    subtitle: "Choose the agent integration to wire. Escape returns to dashboard.",
    bodyTitle: "Agents",
    footer: "  Escape dashboard    Enter configure",
  });

  const select = new SelectRenderable(renderer, {
    id: "agent-select",
    height: AGENT_OPTIONS.length + 2,
    flexGrow: 1,
    flexShrink: 0,
    options: AGENT_OPTIONS,
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    textColor: THEME.silver,
    focusedTextColor: THEME.silver,
    selectedBackgroundColor: THEME.bgSelected,
    selectedTextColor: THEME.white,
    descriptionColor: THEME.dim2,
    selectedDescriptionColor: THEME.silver,
  });

  select.on(SelectRenderableEvents.ITEM_SELECTED, (_, option) => {
    const agentValue = option.value as string;
    const logScreen = buildLogScreen(
      renderer,
      `Configure agent — ${agentValue}`,
      (onLog, onDone) => configureAgent({ agent: agentValue, onLog, onDone }),
      () => onFinished(),
    );
    removeAllChildren(screen);
    screen.add(logScreen);
  });
  select.onKeyDown = (key) => {
    if (key.name === "escape" || key.name === "q") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
    }
  };

  body.add(select);
  select.focus();

  return screen;
}
