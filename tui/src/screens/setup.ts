// screens/setup.ts — two-phase setup wizard using native OpenTUI.
// Phase 1: native CheckList for add-on selection (writes config.json).
// Phase 2: log screen streaming runSetup() output in-TUI.

import { type CliRenderer, BoxRenderable, SelectRenderable, SelectRenderableEvents, TextRenderable } from "@opentui/core";
import { CheckList, type CheckItem } from "../checklist.ts";
import { writeConfig, readConfig, type AddonKey } from "../lib/config.ts";
import { runSetup } from "../lib/setup.ts";
import { THEME } from "../theme.ts";
import { buildEmbeddedRouteChrome, removeAllChildren } from "./chrome.ts";
import { buildLogScreen } from "./log.ts";

type SetupItem = CheckItem & { key: AddonKey | `__${string}` };

const ADDON_ITEMS: SetupItem[] = [
  { key: "__local", label: "Local chat", description: "Installs the model used by Chat with Twilio.", heading: true },
  { key: "localGemma"   as AddonKey, label: "Local model for Chat with Twilio",  description: "Required for in-app local chat and Pi (~2.5 GB)" },
  { key: "__tools", label: "Twilio tools", description: "Optional local tools.", heading: true },
  { key: "devPhone"     as AddonKey, label: "Install Dev Phone",          description: "Browser soft phone for SMS + voice" },
];

function isConfigItem(item: SetupItem): item is SetupItem & { key: AddonKey } {
  return !item.heading;
}

const CONFIG_ITEMS = ADDON_ITEMS.filter(isConfigItem);

export function buildSetupScreen(
  renderer: CliRenderer,
  onFinished: () => void,
  onCancel: () => void,
): BoxRenderable {
  const current = readConfig();
  const initialChecked = new Set<number>(
    ADDON_ITEMS.map((item, i) => (isConfigItem(item) && current.addons[item.key] ? i : -1)).filter((i) => i >= 0),
  );

  const { screen, body } = buildEmbeddedRouteChrome(renderer, {
    id: "setup-screen",
    route: "Dashboard / Setup",
    title: "Choose what to install",
    subtitle: "Space toggles install choices. Enter saves. Escape returns to dashboard.",
    bodyTitle: "Install Choices",
    footer: "  Escape dashboard    Space toggle choice    Enter save",
  });

  const checklist = new CheckList(renderer, "addon-pick", ADDON_ITEMS, initialChecked);
  body.add(checklist.container);

  // Confirm panel (shown after checklist confirm)
  const confirmLabel = new TextRenderable(renderer, { id: "confirm-label", content: "Choices saved. Run installs now?", fg: THEME.green, visible: false });
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
  confirmSelect.onKeyDown = (key) => {
    if (key.name === "escape" || key.name === "q") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
    }
  };
  body.add(confirmLabel);
  body.add(confirmSelect);

  checklist.onConfirm = (checkedKeys) => {
    // Skills, Docs MCP, and the web-UI MCP are always-on now (no toggle) —
    // they're wired automatically when relevant. Only localGemma and
    // devPhone are user choices. executeMcp self-gates on creds at wire
    // time, so it's kept off in config.
    const addons: Record<AddonKey, boolean> = {
      ...current.addons,
      twilioSkills: true,
      docsMcp: true,
      llamaUiMcp: true,
      executeMcp: false,
      voiceInput: false,
    };
    for (const item of CONFIG_ITEMS) addons[item.key] = checkedKeys.includes(item.key);
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
