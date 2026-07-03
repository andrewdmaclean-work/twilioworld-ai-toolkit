// screens/uninstall.ts — choose uninstall items inside OpenTUI.

import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { CheckList, type CheckItem } from "../checklist.ts";
import { runUninstall, type UninstallKey } from "../lib/uninstall.ts";
import { THEME } from "../theme.ts";
import { buildEmbeddedRouteChrome, removeAllChildren } from "./chrome.ts";
import { buildLogScreen } from "./log.ts";

type UninstallItem = CheckItem & { key: UninstallKey | `__${string}` };

const UNINSTALL_ITEMS: UninstallItem[] = [
  { key: "__twilio", label: "Twilio account and CLI", description: "Remove optional Twilio tooling or the toolkit-created API key.", heading: true },
  { key: "devPhone" as UninstallKey, label: "Dev Phone plugin", description: "Remove @twilio-labs/plugin-dev-phone from the Twilio CLI" },
  { key: "apiKey" as UninstallKey, label: "Toolkit API key", description: "Delete the Twilio API key named twilioworld-toolkit" },
  { key: "twilioCli" as UninstallKey, label: "Global Twilio CLI", description: "Run npm uninstall -g twilio-cli" },
  { key: "__agents", label: "Coding agents", description: "Remove Twilio Skills installed where agents look for them.", heading: true },
  { key: "skills" as UninstallKey, label: "Twilio Skills installed for agents", description: "Remove twilio/ and sendgrid/ from ~/.agents/skills/" },
  { key: "__local", label: "Local toolkit files", description: "Remove files used by this toolkit on this machine.", heading: true },
  { key: "repoSkills" as UninstallKey, label: "Local toolkit copy of Twilio Skills", description: "Remove the copy this toolkit uses; Setup can download it again" },
  { key: "toolkitState" as UninstallKey, label: "Local toolkit state", description: "Remove .toolkit config, Execute MCP creds file, and Pi state" },
  { key: "modelRuntime" as UninstallKey, label: "Local model/runtime files", description: "Remove downloaded Gemma, llamafile, whisper placeholders, logs, and temp files" },
];

const REMOVABLE_ITEMS = UNINSTALL_ITEMS.filter((item): item is UninstallItem & { key: UninstallKey } => !item.heading);

export function buildUninstallScreen(
  renderer: CliRenderer,
  onFinished: () => void,
  onCancel: () => void,
): BoxRenderable {
  const { screen, body } = buildEmbeddedRouteChrome(renderer, {
    id: "uninstall-screen",
    route: "Dashboard / Uninstall",
    title: "Choose what to uninstall",
    subtitle: "Space toggles items. Enter reviews the selection. Escape returns to dashboard.",
    bodyTitle: "Uninstall Items",
    footer: "  Escape dashboard    Space toggle item    Enter review",
  });

  const warning = new TextRenderable(renderer, {
    id: "uninstall-warning",
    content: "Nothing is removed until you confirm on the next screen. Twilio logout is never run.",
    fg: THEME.yellow,
  });
  body.add(warning);

  const checklist = new CheckList(renderer, "uninstall-pick", UNINSTALL_ITEMS, new Set());
  body.add(checklist.container);

  const confirmLabel = new TextRenderable(renderer, {
    id: "uninstall-confirm-label",
    content: "",
    fg: THEME.yellow,
    visible: false,
  });
  const confirmSelect = new SelectRenderable(renderer, {
    id: "uninstall-confirm-select",
    height: 4,
    flexGrow: 1,
    flexShrink: 0,
    visible: false,
    options: [
      { name: "Yes - uninstall selected items", description: "Runs only the checked removals and streams output here" },
      { name: "No - go back", description: "Return to the checklist without removing anything" },
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

  let selected: UninstallKey[] = [];
  function showChecklist(): void {
    warning.visible = true;
    checklist.container.visible = true;
    confirmLabel.visible = false;
    confirmSelect.visible = false;
    checklist.focus();
  }

  confirmSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
    if (index !== 0 || !selected.length) {
      showChecklist();
      return;
    }
    const logScreen = buildLogScreen(
      renderer,
      "Uninstall - removing selected items",
      (onLog, onDone) => runUninstall({ keys: selected, onLog, onDone }),
      () => onFinished(),
    );
    removeAllChildren(screen);
    screen.add(logScreen);
  });
  confirmSelect.onKeyDown = (key) => {
    if (key.name === "escape" || key.name === "q") {
      key.preventDefault();
      key.stopPropagation();
      showChecklist();
    }
  };
  body.add(confirmLabel);
  body.add(confirmSelect);

  checklist.onConfirm = (checkedKeys) => {
    selected = checkedKeys as UninstallKey[];
    if (!selected.length) {
      confirmLabel.content = "No items selected. Choose No to go back or Escape to return.";
      confirmSelect.options = [
        { name: "No - go back", description: "Return to the checklist" },
      ];
    } else {
      const labels = REMOVABLE_ITEMS
        .filter((item) => selected.includes(item.key))
        .map((item) => `* ${item.label}`)
        .join("   ");
      confirmLabel.content = `Selected: ${labels}`;
      confirmSelect.options = [
        { name: "Yes - uninstall selected items", description: "Runs only the checked removals and streams output here" },
        { name: "No - go back", description: "Return to the checklist without removing anything" },
      ];
    }
    warning.visible = false;
    checklist.container.visible = false;
    confirmLabel.visible = true;
    confirmSelect.visible = true;
    confirmSelect.setSelectedIndex(0);
    confirmSelect.focus();
  };
  checklist.onCancel = () => onCancel();
  checklist.focus();

  return screen;
}
