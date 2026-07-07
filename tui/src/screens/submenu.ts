// screens/submenu.ts — a reusable SelectRenderable-based submenu route.
//
// Renders a list of choices inside the standard embedded route chrome.
// Each choice carries an onSelect callback. Escape/q returns to the
// dashboard via onCancel. Used for the "Chat with Twilio" (TUI vs GUI)
// and "Twilio links" submenus.

import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
} from "@opentui/core";
import { THEME } from "../theme.ts";
import { buildEmbeddedRouteChrome } from "./chrome.ts";

export interface SubmenuOption {
  name: string;
  description: string;
  /** Called when this option is chosen. Return true to return to the
   *  dashboard afterward, false/undefined to stay on the submenu. */
  onSelect: () => boolean | void;
}

export function buildSubmenuScreen(
  renderer: CliRenderer,
  opts: {
    id: string;
    route: string;
    title: string;
    subtitle: string;
    bodyTitle: string;
    options: SubmenuOption[];
  },
  onCancel: () => void,
): BoxRenderable {
  const { screen, body } = buildEmbeddedRouteChrome(renderer, {
    id: opts.id,
    route: opts.route,
    title: opts.title,
    subtitle: opts.subtitle,
    bodyTitle: opts.bodyTitle,
    footer: "  Escape dashboard    Enter select",
  });

  const select = new SelectRenderable(renderer, {
    id: `${opts.id}-select`,
    height: opts.options.length + 2,
    flexGrow: 1,
    flexShrink: 0,
    options: opts.options.map((o, i) => ({ name: o.name, description: o.description, value: String(i) })),
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
    const idx = parseInt(option.value as string, 10);
    const choice = opts.options[idx];
    if (!choice) return;
    const done = choice.onSelect();
    if (done) onCancel();
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
