import { type CliRenderer, type BoxRenderable } from "@opentui/core";
import type { ToolkitStatus } from "../status.ts";
import type { ModelReasoningMode } from "../lib/config.ts";
import { LOCAL_MODEL_SIZE_LABEL, MODEL_SERVER_PORT } from "../lib/constants.ts";
import { buildSubmenuScreen } from "./submenu.ts";

function reasoningLabel(mode: ModelReasoningMode): string {
  if (mode === "on") return "Thoughtful";
  if (mode === "auto") return "Light";
  return "Fast";
}

export function buildModelControlsScreen(
  renderer: CliRenderer,
  opts: {
    status: ToolkitStatus | null;
    reasoningMode: ModelReasoningMode;
    onOpenBrowser: () => void;
    onToggleReasoning: () => void;
    onStop: () => void;
    onRemove: () => void;
    onMissingModel: () => void;
    onCancel: () => void;
  },
): BoxRenderable {
  return buildSubmenuScreen(renderer, {
    id: "model-controls-screen",
    route: "Dashboard / Settings / Local AI model",
    title: "Local AI model",
    subtitle: "Use browser chat, choose a response style, or manage local files.",
    bodyTitle: "Local AI model",
    options: [
      {
        name: "Open browser chat",
        description: opts.status?.model.ready ? "start the model if needed, then open chat in your browser" : "install Local Chat from Components first",
        onSelect: () => {
          if (!opts.status?.model.ready) { opts.onMissingModel(); return false; }
          opts.onOpenBrowser();
          return true;
        },
      },
      {
        name: `Response style: ${reasoningLabel(opts.reasoningMode)}`,
        description: "Enter cycles through Fast, Light, and Thoughtful",
        onSelect: () => { opts.onToggleReasoning(); return true; },
      },
      {
        name: "Stop local AI",
        description: opts.status?.model.running ? `currently running on :${MODEL_SERVER_PORT}` : "the local AI is not running",
        onSelect: () => { opts.onStop(); return true; },
      },
      {
        name: "Remove downloaded model",
        description: opts.status?.model.ready ? `free approximately ${LOCAL_MODEL_SIZE_LABEL} of local storage` : "no model files are installed",
        onSelect: () => { opts.onRemove(); return false; },
      },
    ],
  }, opts.onCancel);
}
