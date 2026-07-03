// screens/log.ts — streaming command output screen.
// Shows a header, a scrollable log pane with live output, and a status
// footer. Used for Setup installs, Configure agent, and any other
// multi-step command sequence that streams output.
//
// The caller provides an async `run` function that receives an `onLog`
// callback and a `onDone(ok)` callback. The screen subscribes to those
// and renders output line-by-line into a ScrollBox.

import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { THEME } from "../theme.ts";
import { buildEmbeddedRouteChrome } from "./chrome.ts";

const ERR_COLOR = "#EF4444";
const START_DELAY_MS = 75;

function colorFor(line: string, stream: "stdout" | "stderr"): string {
  if (line.startsWith("✓")) return THEME.green;
  if (line.startsWith("✗")) return ERR_COLOR;
  if (line.startsWith("⚠")) return THEME.yellow;
  if (line.startsWith("▶")) return THEME.red;
  if (stream === "stderr") return THEME.yellow;
  return THEME.silver;
}

function wrapText(text: string, width: number): string {
  if (width <= 0) return text;
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (!raw) {
      out.push("");
      continue;
    }
    let line = raw;
    while (line.length > width) {
      let cut = line.lastIndexOf(" ", width);
      if (cut < Math.max(12, Math.floor(width * 0.4))) cut = width;
      out.push(line.slice(0, cut).trimEnd());
      line = line.slice(cut).trimStart();
    }
    out.push(line);
  }
  return out.join("\n");
}

export function buildLogScreen(
  renderer: CliRenderer,
  title: string,
  run: (
    onLog: (line: string, stream: "stdout" | "stderr") => void,
    onDone: (ok: boolean) => void,
  ) => void,
  onFinished: (ok: boolean) => void,
): BoxRenderable {
  const { screen, body, footer } = buildEmbeddedRouteChrome(renderer, {
    id: "log-screen",
    route: "Dashboard / Task Log",
    title,
    subtitle: "Streaming command output inside the OpenTUI session.",
    bodyTitle: "Live Output",
    footer: "  In-app task log    Waiting for command output",
  });

  const scroll = new ScrollBoxRenderable(renderer, {
    id: "log-scroll",
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
  });
  body.add(scroll);

  let lineCount = 0;

  function onLog(line: string, stream: "stdout" | "stderr") {
    if (!line.trim()) return; // skip blank lines
    lineCount++;
    scroll.content.add(
      new TextRenderable(renderer, {
        id: `log-line-${lineCount}`,
        content: wrapText(line, Math.max(24, (scroll.width ?? renderer.width) - 8)),
        fg: colorFor(line, stream),
      }),
    );
  }

  function onDone(ok: boolean) {
    footer.content = ok
      ? "  ✓  Done — press any key to return to dashboard"
      : "  ✗  Finished with errors — press any key to return to dashboard";
    footer.fg = ok ? THEME.green : ERR_COLOR;

    // Wait for a keypress before handing back to the dashboard.
    const handler = (key: unknown) => {
      renderer.keyInput.removeListener("keypress", handler);
      onFinished(ok);
    };
    renderer.keyInput.on("keypress", handler);
  }

  onLog("Starting task...", "stdout");
  footer.content = "  Starting task...";
  footer.fg = THEME.yellow;

  // Yield at least one render frame before setup/uninstall begins. Those flows
  // do some synchronous local checks before their first subprocess, and starting
  // them in a microtask makes the TUI look frozen after the user confirms.
  setTimeout(() => {
    try {
      run(onLog, onDone);
    } catch (e) {
      onLog((e as Error).message, "stderr");
      onDone(false);
    }
  }, START_DELAY_MS);

  return screen;
}
