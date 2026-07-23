// screens/setup.ts — two-phase setup wizard using native OpenTUI.
// Phase 1: native CheckList for add-on selection (writes config.json).
// Phase 2: log screen streaming runSetup() output in-TUI.

import { type CliRenderer, BoxRenderable, SelectRenderable, SelectRenderableEvents, TextRenderable } from "@opentui/core";
import { CheckList, type CheckItem } from "../checklist.ts";
import { writeConfig, readConfig, type AddonKey } from "../lib/config.ts";
import { capture, have } from "../lib/exec.ts";
import { modelReady } from "../lib/model.ts";
import { getSelectedModel } from "../lib/local-models.ts";
import { runSetup } from "../lib/setup.ts";
import { THEME } from "../theme.ts";
import { SELECT_STYLE, shortcutBar } from "../ui-style.ts";
import { buildEmbeddedRouteChrome, removeAllChildren } from "./chrome.ts";
import { createInputGuard } from "./input-guard.ts";
import { buildLogScreen } from "./log.ts";

type SetupItem = CheckItem & { key: AddonKey | `__${string}`; done?: boolean };

function isConfigItem(item: SetupItem): item is SetupItem & { key: AddonKey } {
  return !item.heading;
}

function doneLabel(done: boolean, label: string): string {
  return done ? `✓ ${label}` : label;
}

function devPhoneInstalled(): boolean {
  return have("twilio") && capture("twilio", ["plugins"]).includes("plugin-dev-phone");
}

function buildAddonItems(): SetupItem[] {
  const model = modelReady();
  const localDone = model.runtime && model.weights;
  const devDone = devPhoneInstalled();
  return [
    { key: "__local", label: "Ask Twilio", description: localDone ? "Done." : "Installs the private local AI model.", heading: true },
    {
      key: "localGemma" as AddonKey,
      label: doneLabel(localDone, "Local AI model"),
      description: localDone ? "Downloaded and ready." : `Required for Ask Twilio and Pi (~${getSelectedModel().sizeLabel})`,
      done: localDone,
    },
    { key: "__tools", label: "Twilio tools", description: devDone ? "Done." : "Optional local tools.", heading: true },
    {
      key: "devPhone" as AddonKey,
      label: doneLabel(devDone, "Install Dev Phone"),
      description: devDone ? "Dev Phone plugin installed." : "Browser soft phone for SMS + voice",
      done: devDone,
    },
  ];
}

export function buildSetupScreen(
  renderer: CliRenderer,
  onFinished: () => void,
  onCancel: () => void,
  opts: { firstRun?: boolean } = {},
): BoxRenderable {
  const current = readConfig();
  const addonItems = buildAddonItems();
  const configItems = addonItems.filter(isConfigItem);
  const initialChecked = new Set<number>(
    addonItems.map((item, i) => (isConfigItem(item) && (current.addons[item.key] || item.done) ? i : -1)).filter((i) => i >= 0),
  );

  const { screen, body } = buildEmbeddedRouteChrome(renderer, {
    id: "setup-screen",
    route: opts.firstRun ? "Welcome" : "Dashboard / Settings / Components",
    title: opts.firstRun ? "Set up your toolkit" : "Components",
    subtitle: opts.firstRun
      ? "Choose what you need now. You can change these choices later."
      : "Space toggles install choices. Enter saves. Escape returns to dashboard.",
    bodyTitle: "Choose components to install",
    footer: opts.firstRun
      ? shortcutBar(["Esc", "use defaults"], ["Space", "toggle"], ["Enter", "continue"])
      : shortcutBar(["Esc", "dashboard"], ["Space", "toggle"], ["Enter", "save"]),
  });

  const checklist = new CheckList(renderer, "addon-pick", addonItems, initialChecked);
  body.add(checklist.container);

  // Confirm panel (shown after checklist confirm)
  const confirmLabel = new TextRenderable(renderer, { id: "confirm-label", content: "Choices saved. Run installs now?", fg: THEME.green, visible: false });
  const confirmSelect = new SelectRenderable(renderer, {
    id: "confirm-select", height: 4, flexGrow: 1, flexShrink: 0, visible: false,
    options: [
      { name: "Install selected components", description: "Runs setup here and shows progress" },
      { name: opts.firstRun ? "Continue without installing" : "Save choices only", description: "Install these components later from Settings" },
    ],
    ...SELECT_STYLE,
  });
  const confirmGuard = createInputGuard();
  confirmSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
    if (!confirmGuard.ready()) return;
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
    for (const item of configItems) addons[item.key] = checkedKeys.includes(item.key) || Boolean(item.done);
    writeConfig(addons);
    checklist.container.visible = false;
    confirmLabel.visible = true;
    confirmSelect.visible = true;
    confirmSelect.setSelectedIndex(1);
    confirmSelect.focus();
    confirmGuard.arm();
  };
  checklist.onCancel = () => {
    if (opts.firstRun) {
      writeConfig(current.addons, current.settings);
      onFinished();
      return;
    }
    onCancel();
  };
  checklist.focus();

  return screen;
}
