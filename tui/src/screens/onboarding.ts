// screens/onboarding.ts — first-run guided setup.
//
// Shown once, when no .toolkit/config.json exists. Presents the opinionated
// happy path as a checklist of steps the user can run or skip:
//   1. Twilio CLI + Dev Phone
//   2. Local AI chat (Gemma, ~2.5GB)
//   3. Configure a coding agent
//
// Each step runs in a log screen and returns here. "Go to dashboard"
// finishes onboarding (writes config so this never auto-runs again).

import { type CliRenderer, BoxRenderable } from "@opentui/core";
import { buildEmbeddedRouteChrome, removeAllChildren } from "./chrome.ts";
import { buildSubmenuScreen } from "./submenu.ts";
import { buildLogScreen } from "./log.ts";
import { buildAgentScreen } from "./agent.ts";
import { downloadLocalModel, installDevPhone } from "../lib/actions.ts";
import { writeConfig, readConfig } from "../lib/config.ts";

/** Persist config so onboarding is considered "done" and never auto-runs. */
function markOnboarded(): void {
  const cfg = readConfig();
  writeConfig(cfg.addons);
}

export function buildOnboardingScreen(
  renderer: CliRenderer,
  onFinished: () => void,
): BoxRenderable {
  // Host box we can swap children in/out of (log screens, agent screen).
  const host = new BoxRenderable(renderer, {
    id: "onboarding-host",
    width: "100%",
    height: "100%",
    flexGrow: 1,
    flexDirection: "column",
  });

  function showMenu(): void {
    removeAllChildren(host);
    const menu = buildSubmenuScreen(renderer, {
      id: "onboarding-menu",
      route: "Welcome",
      title: "Let's get you set up",
      subtitle: "Run any step, or skip straight to the dashboard. Escape = dashboard.",
      bodyTitle: "First-time setup",
      options: [
        {
          name: "1 · Twilio CLI + Dev Phone",
          description: "install the CLI and the browser soft phone (real SMS + voice)",
          onSelect: () => { runStep("Twilio CLI + Dev Phone", (l, d) => installDevPhone({ onLog: l, onDone: d })); return false; },
        },
        {
          name: "2 · Local AI chat (Gemma, ~2.5GB)",
          description: "download the offline model so Chat with Twilio Docs works",
          onSelect: () => { runStep("Local AI chat (Gemma)", (l, d) => downloadLocalModel({ onLog: l, onDone: d })); return false; },
        },
        {
          name: "3 · Configure a coding agent",
          description: "wire Twilio Skills + Docs MCP into Pi, Claude Code, Cursor, Codex…",
          onSelect: () => { showAgent(); return false; },
        },
        {
          name: "Go to dashboard",
          description: "finish setup — you can do any of the above later from the menu",
          onSelect: () => { markOnboarded(); onFinished(); return false; },
        },
      ],
    }, () => { markOnboarded(); onFinished(); });
    host.add(menu);
  }

  function runStep(
    title: string,
    run: (onLog: (l: string, s: "stdout" | "stderr") => void, onDone: (ok: boolean) => void) => void | Promise<void>,
  ): void {
    removeAllChildren(host);
    host.add(buildLogScreen(renderer, title, run, () => showMenu()));
  }

  function showAgent(): void {
    removeAllChildren(host);
    host.add(buildAgentScreen(renderer, () => showMenu(), () => showMenu()));
  }

  showMenu();
  return host;
}
