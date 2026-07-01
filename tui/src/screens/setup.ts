// screens/setup.ts — two-phase setup wizard using native OpenTUI.
// Phase 1: native CheckList for add-on selection (writes config.json).
// Phase 2: log screen streaming runSetup() output in-TUI.

import { type CliRenderer, BoxRenderable, SelectRenderable, SelectRenderableEvents, TextRenderable } from "@opentui/core";
import { CheckList } from "../checklist.ts";
import { writeConfig, readConfig, type AddonKey } from "../lib/config.ts";
import { runSetup } from "../lib/setup.ts";
import { THEME } from "../theme.ts";
import { buildEmbeddedRouteChrome, removeAllChildren } from "./chrome.ts";
import { buildLogScreen } from "./log.ts";

const ADDON_ITEMS = [
  { key: "twilioSkills" as AddonKey, label: "Twilio Skills",      description: "Loads 56+ skills into your agent" },
  { key: "docsMcp"      as AddonKey, label: "Docs MCP",           description: "Live Twilio API search (1,800+ endpoints)" },
  { key: "executeMcp"   as AddonKey, label: "Execute MCP",        description: "Agent can call real Twilio APIs — experimental" },
  { key: "devPhone"     as AddonKey, label: "Dev Phone",          description: "Browser soft phone for SMS + voice" },
  { key: "localGemma"   as AddonKey, label: "Local Gemma model",  description: "Free offline model — powers in-app chat + Pi (~2.5 GB)" },
  { key: "voiceInput"   as AddonKey, label: "Voice input",        description: "Ctrl+R chat shortcut wired; local Whisper support coming soon" },
];

export function buildSetupScreen(
  renderer: CliRenderer,
  onFinished: () => void,
  onCancel: () => void,
): BoxRenderable {
  const current = readConfig();
  const initialChecked = new Set<number>(
    ADDON_ITEMS.map((item, i) => (current.addons[item.key] ? i : -1)).filter((i) => i >= 0),
  );

  const { screen, body } = buildEmbeddedRouteChrome(renderer, {
    id: "setup-screen",
    route: "Dashboard / Setup",
    title: "Choose add-ons",
    subtitle: "Space toggles add-ons. Enter saves. Escape returns to dashboard.",
    bodyTitle: "Add-ons",
    footer: "  Escape dashboard    Space toggle add-on    Enter save",
  });

  const checklist = new CheckList(renderer, "addon-pick", ADDON_ITEMS, initialChecked);
  body.add(checklist.container);

  // Confirm panel (shown after checklist confirm)
  const confirmLabel = new TextRenderable(renderer, { id: "confirm-label", content: "Add-ons saved. Run installs now?", fg: THEME.green, visible: false });
  const confirmSelect = new SelectRenderable(renderer, {
    id: "confirm-select", height: 4, flexGrow: 1, flexShrink: 0, visible: false,
    options: [
      { name: "Yes — install now",          description: "Runs in this window, streaming output" },
      { name: "No — save choices only",     description: "Run Setup again any time to install" },
    ],
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    textColor: THEME.silver,
    focusedTextColor: THEME.silver,
    selectedBackgroundColor: THEME.bgSelected,
    selectedTextColor: THEME.white,
    descriptionColor: THEME.dim2,
    selectedDescriptionColor: THEME.silver,
  });
  confirmSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
    confirmLabel.visible = false;
    confirmSelect.visible = false;
    if (index === 0) {
      // Replace screen content with a log pane and stream runSetup()
      const logScreen = buildLogScreen(
        renderer, "Setup — installing",
        (onLog, onDone) => runSetup({ onLog, onDone }),
        () => onFinished(),
      );
      removeAllChildren(screen);
      screen.add(logScreen);
    } else {
      onFinished();
    }
  });
  confirmSelect.onKeyDown = (key) => { if (key.name === "escape") onCancel(); };
  body.add(confirmLabel);
  body.add(confirmSelect);

  checklist.onConfirm = (checkedKeys) => {
    const addons = Object.fromEntries(ADDON_ITEMS.map((item) => [item.key, checkedKeys.includes(item.key)])) as Record<AddonKey, boolean>;
    writeConfig(addons);
    checklist.container.visible = false;
    confirmLabel.visible = true;
    confirmSelect.visible = true;
    confirmSelect.focus();
  };
  checklist.onCancel = () => onCancel();
  checklist.focus();

  return screen;
}
