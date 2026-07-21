// index.ts — TwilioWorld Agentic Coding Toolkit TUI
// Layout: branded header · actions · active features · selected-action detail.

import {
  ASCIIFontRenderable,
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
} from "@opentui/core";

import { invalidateStatusCache, readStatusAsync, type ToolkitStatus } from "./status.ts";
import { existsSync } from "fs";
import { buildAgentScreen } from "./screens/agent.ts";
import { buildChatScreen } from "./screens/chat.ts";
import { buildSubmenuScreen } from "./screens/submenu.ts";
import { buildLogScreen } from "./screens/log.ts";
import { buildSetupScreen } from "./screens/setup.ts";
import { buildRobotFace } from "./screens/robot-face.ts";
import { buildModelControlsScreen } from "./screens/model-controls.ts";
import { buildSettingsScreen } from "./screens/settings.ts";
import { buildResourcesScreen } from "./screens/resources.ts";
import {
  downloadLocalModel, installDevPhone, installTwilioCli,
  openDevPhone, openTwilioLogin, openTwilioTerminal, stopModelServer,
  setupExecuteMcp, listTwilioProfiles, useTwilioProfile, activeAccountSid,
} from "./lib/actions.ts";
import { buildCredsPromptScreen } from "./screens/creds-prompt.ts";
import { loadToolkitEnv } from "./lib/env.ts";
import { runUninstall, type UninstallKey } from "./lib/uninstall.ts";
import { buildInvadersScreen } from "./screens/invaders.ts";
import { modelReasoningMode, setModelReasoningMode, type ModelReasoningMode } from "./lib/config.ts";
import {
  LLAMAFILE_DEST, LOCAL_MODEL_SIZE_LABEL, ROOT, MODEL_SERVER_PID, MODEL_SERVER_PORT, MODEL_SERVER_URL, CONFIG_FILE,
} from "./lib/constants.ts";
import { MODEL_SERVER_LOG, serverArgs } from "./lib/model.ts";
import { openUrl, openLlamaWebUi, startMcpProxy, capture, have, startDaemon } from "./lib/exec.ts";
import { pathNodeVersion, supportsPiNode } from "./lib/node-version.ts";
import { THEME } from "./theme.ts";
import { SELECT_STYLE, shortcutBar } from "./ui-style.ts";

// ── Palette ──────────────────────────────────────────────────────────
const RED      = THEME.red;
const WHITE    = THEME.white;
const SILVER   = THEME.silver;
const DIM      = THEME.dim;
const DIM2     = THEME.dim2;
const GREEN    = THEME.green;
const YELLOW   = THEME.yellow;
const CYAN     = THEME.cyan;
const BG_PANEL = THEME.panelBg;
const POLL_MS  = 30000;

const TERMINAL_RESTORE = [
  "\x1b[?1000l", // basic mouse
  "\x1b[?1001l", // highlight mouse
  "\x1b[?1002l", // button-event mouse
  "\x1b[?1003l", // any-event mouse
  "\x1b[?1005l", // UTF-8 mouse
  "\x1b[?1004l", // focus events
  "\x1b[?1006l", // SGR mouse
  "\x1b[?1007l", // alternate scroll
  "\x1b[?1015l", // urxvt mouse
  "\x1b[?2004l", // bracketed paste
  "\x1b[?2026l", // synchronized output
  "\x1b[?2027l",
  "\x1b[?2031l",
  "\x1b[?25h",   // show cursor
  "\x1b[0m",
].join("");

function forceTerminalRestore(): void {
  if (process.stdout.isTTY) {
    try { process.stdout.write(TERMINAL_RESTORE); } catch { /* ignore */ }
  }
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try { process.stdin.setRawMode(false); } catch { /* ignore */ }
  }
}

function assertInteractiveTerminal(): void {
  if (process.env.TOOLKIT_TUI_SMOKE === "1") return;
  const term = process.env.TERM ?? "";
  if (!process.stdin.isTTY || !process.stdout.isTTY || term === "dumb") {
    console.error("TwilioWorld Agentic Coding Toolkit requires an interactive terminal for OpenTUI.");
    console.error("Run ./toolkit from a real terminal window, not through a pipe, task runner output panel, or dumb terminal.");
    process.exit(2);
  }
}

function assertCompatibleNode(): void {
  if (process.env.TOOLKIT_TUI_SMOKE === "1") return;
  const nodeInfo = pathNodeVersion();
  if (!supportsPiNode(nodeInfo)) {
    console.error("TwilioWorld Agentic Coding Toolkit requires project-local Node >= 22.19.0.");
    console.error(`Current node is ${nodeInfo?.raw ?? "not found"}. Re-run ./toolkit so it can repair .toolkit/toolchains/node-v22.`);
    process.exit(2);
  }
}

// Security audit E-8/H-4: if the toolkit is ever run as root (sudo out of
// habit, or a shared/CI box), downloaded models, .toolkit/config.json,
// and the creds file would all end up root-owned — breaking every
// subsequent normal-user run and leaving world-unreadable-by-you files
// behind. No-op on Windows (no EUID concept, no getuid()).
function assertNotRoot(): void {
  if (process.env.TOOLKIT_TUI_SMOKE === "1") return;
  if (process.platform === "win32") return;
  if (typeof process.getuid !== "function") return;
  if (process.getuid() === 0) {
    console.error("TwilioWorld Agentic Coding Toolkit should not be run as root.");
    console.error("Re-run ./toolkit as your normal user — sudo here would root-own your model files and config.");
    process.exit(2);
  }
}

function clip(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
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

function nextMove(s: ToolkitStatus | null): string {
  if (!s) return "Loading local status.";
  if (!s.model.ready) return `Ask Twilio will download the local model (~${LOCAL_MODEL_SIZE_LABEL}) on first use.`;
  if (!s.twilio.installed) return "Twilio CLI opens/installs from the Twilio CLI menu when you need it.";
  return "Ask Twilio, configure an agent, or open Dev Phone.";
}

function headlineText(s: ToolkitStatus | null): string {
  const model = s?.model.running ? "model online" : s?.model.ready ? "model ready" : "model not downloaded";
  const twilio = s?.twilio.sid ? `Twilio ${s.twilio.profile}` : "Twilio not logged in";
  return [model, twilio].filter(Boolean).join("  |  ");
}

function modelReasoningLabel(mode: ModelReasoningMode): string {
  if (mode === "on") return "Thoughtful";
  if (mode === "auto") return "Light";
  return "Fast";
}

function nextModelReasoningMode(mode: ModelReasoningMode): ModelReasoningMode {
  if (mode === "off") return "auto";
  if (mode === "auto") return "on";
  return "off";
}

// ── Status rail ──────────────────────────────────────────────────────
function statusLines(s: ToolkitStatus | null) {
  const row = (icon: string, label: string, value: string, fg: string) => ({
    text: `  ${icon}  ${label.padEnd(11)} ${value}`,
    fg,
  });
  if (!s) return [
    row("◌", "Model", "Checking", DIM2),
    row("◌", "Twilio", "Checking", DIM2),
    row("◌", "Agents", "Checking", DIM2),
    row("◌", "Docs MCP", "Checking", DIM2),
    row("◌", "Dev Phone", "Checking", DIM2),
  ];

  const agentCount = Number(s.pi.installed) + Number(s.opencode.installed);
  return [
    s.model.running
      ? row("●", "Model", `Online :${MODEL_SERVER_PORT}`, GREEN)
      : s.model.ready ? row("●", "Model", "Ready", CYAN) : row("○", "Model", "Not installed", DIM2),
    s.twilio.sid
      ? row("●", "Twilio", s.twilio.profile || "Connected", GREEN)
      : s.twilio.installed ? row("○", "Twilio", "Sign-in needed", YELLOW) : row("○", "Twilio", "CLI not installed", DIM2),
    agentCount > 0
      ? row("●", "Agents", `${agentCount} detected`, CYAN) : row("○", "Agents", "None detected", DIM2),
    (s.skills.installedCount ?? 0) > 0
      ? row("●", "Docs MCP", `${s.skills.installedCount} skills ready`, GREEN) : row("○", "Docs MCP", "Setup needed", DIM2),
    s.devPhone.installed
      ? row("●", "Dev Phone", "Installed", CYAN) : row("○", "Dev Phone", "Optional", DIM2),
  ];
}

// ── Menu definition ──────────────────────────────────────────────────
type ItemId = "chat"|"agent"|"devphone"|"cli"|"resources"|"settings"|"exit";

interface MenuItem {
  id: ItemId;
  label: (s: ToolkitStatus | null) => string;
  detail: (s: ToolkitStatus | null) => string;
  visible: (s: ToolkitStatus) => boolean;
}

function doneLabel(done: boolean, label: string): string {
  return done ? `✓ ${label}` : label;
}

const ALL_ITEMS: MenuItem[] = [
  { id: "chat",
    label: (s) => doneLabel(Boolean(s?.model.ready), "Ask Twilio"),
    detail: (s) => s?.model.ready ? "local AI chat — model downloaded" : "local AI chat — downloads model on first use",
    visible: () => true },

  { id: "agent",
    label: () => "Configure agent",
    detail: () => "wire Skills + Docs MCP into Pi, Claude Code, Cursor, Codex, OpenCode, Copilot",
    visible: () => true },

  { id: "devphone",
    label: (s) => doneLabel(Boolean(s?.devPhone.installed), "Dev Phone"),
    detail: (s) => s?.devPhone.installed ? "browser soft phone — installed" : "browser soft phone — real SMS + voice",
    visible: () => true },

  { id: "cli",
    label: (s) => doneLabel(Boolean(s?.twilio.installed), "Twilio CLI"),
    detail: (s) => s?.twilio.sid ? `logged in as ${s.twilio.profile}` : s?.twilio.installed ? "installed, not logged in" : "open a terminal, log in, check account, or uninstall",
    visible: () => true },

  { id: "resources",
    label: () => "Resources",
    detail: () => "TwilioWorld and Twilio AI Docs",
    visible: () => true },

  { id: "settings",
    label: () => "Settings",
    detail: () => "choose components or manage the local AI model",
    visible: () => true },

  { id: "exit",
    label: () => "Exit",
    detail: () => "",
    visible: () => true },
];

function visibleItems(s: ToolkitStatus | null): MenuItem[] {
  return ALL_ITEMS.filter((m) => (s ? m.visible(s) : true));
}

function yesNo(v: boolean): string {
  return v ? "Ready" : "Needs setup";
}

function detailFor(item: MenuItem | undefined, s: ToolkitStatus | null): string {
  if (!item || item.id === "exit") return "";
  switch (item.id) {
    case "chat":
      return [
        "OVERVIEW",
        "  Ask Twilio questions using local AI grounded in Twilio Skills and",
        "  current documentation.",
        "",
        "READINESS",
        `  Runtime       ${yesNo(Boolean(s?.model.runtimeReady))}`,
        `  Weights       ${yesNo(Boolean(s?.model.fileReady))}`,
        `  Service       ${s?.model.running ? "Online" : "Stopped"}`,
        "",
        s?.model.ready
          ? "RESULT\n  Private, local answers grounded in Twilio guidance."
          : `DOWNLOAD\n  Local model and runtime, approximately ${LOCAL_MODEL_SIZE_LABEL}.`,
      ].join("\n");
    case "agent":
      return [
        "OVERVIEW",
        "  Wire Twilio Skills + Docs MCP into whichever coding agent you pick,",
        "  then launch it. Pi is installed + launched for you; others get wired.",
        "",
        "INCLUDED",
        "  Twilio Skills + Docs MCP (no auth, no config needed)",
        "",
        "EXECUTE MCP",
        `  Read-only credentials  ${yesNo(Boolean(process.env.TWILIO_MCP_CREDS))}`,
      ].join("\n");
    case "devphone":
      return [
        "OVERVIEW",
        "  Browser soft phone — send/receive real SMS and voice with no device.",
        "",
        "READINESS",
        `  Twilio CLI    ${yesNo(Boolean(s?.twilio.installed))}`,
        `  Dev Phone     ${yesNo(Boolean(s?.devPhone.installed))}`,
        `  Account       ${s?.twilio.sid ? "Connected" : "Needs sign-in"}`,
        "",
        "NOTICE",
        "  Use a spare number; Dev Phone can replace its webhook settings.",
      ].join("\n");
    case "cli":
      return [
        "OVERVIEW",
        "  Twilio CLI hub — open a terminal, log in, check your account, or",
        "  uninstall the CLI.",
        "",
        "STATUS",
        `  CLI           ${yesNo(Boolean(s?.twilio.installed))}`,
        s?.twilio.sid ? `  Account       ${s.twilio.profile} (${s.twilio.sid})` : "  Account       Not connected",
      ].join("\n");
    case "resources":
      return [
        "RESOURCES",
        "  Open TwilioWorld or browse the Twilio AI documentation.",
      ].join("\n");
    case "settings":
      return [
        "SETTINGS",
        "  Components     Choose and install Ask Twilio or Dev Phone.",
        "  Local AI       Browser chat, response style, process, and storage.",
      ].join("\n");
  }
}

// ── Dashboard factory ────────────────────────────────────────────────
export function buildDashboard(renderer: CliRenderer, onQuit: () => void) {
  const STATUS_ROWS = 5;
  type CompactPane = "actions" | "status" | "details";
  let compactPane: CompactPane = "actions";
  let narrowLayout = false;
  let statusContentWidth = 40;
  let detailContentWidth = 40;

  // ── Widgets ─────────────────────────────────────────────────────
  const header = new BoxRenderable(renderer, {
    id: "header",
    borderStyle: "single",
    borderColor: THEME.borderStrong,
    title: " TwilioWorld ",
    titleColor: RED,
    paddingX: 1,
    flexDirection: "row",
    backgroundColor: BG_PANEL,
  });
  // Small ASCII wordmark, stacked above the subtitle — @opentui/core ships
  // this font data already (no figlet/lolcat dependency needed). A multi-row
  // glyph can't sit "inline with the border" (the border is only 1 row
  // tall, every ASCIIFont is >= 2 rows — tried it, it either collides with
  // the subtitle or gets half its letters clipped off). "TwilioWorld" in
  // the "tiny" font is only 44 cols x 2 rows, so it stacks in normal flow
  // above the subtitle text without needing any special positioning.
  // resize() below only shows it once there's room, falling back to the
  // plain border title on narrower terminals so nothing clips.
  const banner = new ASCIIFontRenderable(renderer, {
    id: "header-banner",
    text: "TwilioWorld",
    font: "tiny",
    color: RED,
  });
  const titleText = new TextRenderable(renderer, {
    id: "header-title",
    content: "Agentic Coding Toolkit",
    fg: WHITE,
  });
  const headline = new TextRenderable(renderer, {
    id: "header-headline",
    content: headlineText(null),
    fg: CYAN,
  });
  const nextText = new TextRenderable(renderer, {
    id: "header-next",
    content: `Next: ${nextMove(null)}`,
    fg: YELLOW,
  });
  const brand = new BoxRenderable(renderer, {
    id: "header-brand",
    flexDirection: "column",
    flexGrow: 1,
  });
  brand.add(banner);
  brand.add(titleText);
  brand.add(headline);
  brand.add(nextText);
  const robot = buildRobotFace(renderer);
  header.add(brand);
  header.add(robot.container);

  // Left column: menu
  const MENU_W = 36;
  const menuCol = new BoxRenderable(renderer, {
    id: "menu-col", borderStyle: "single", borderColor: THEME.border,
    title: " Actions ", titleColor: THEME.redSoft,
    width: MENU_W, flexShrink: 0,
    backgroundColor: BG_PANEL,
  });
  const menuList = new SelectRenderable(renderer, {
    id: "menu-list",
    width: MENU_W - 2, height: 10, // overridden by resize()
    options: [],
    ...SELECT_STYLE,
    showScrollIndicator: false, showDescription: false,
  });
  menuCol.add(menuList);

  // Right column: status + detail
  const rightCol = new BoxRenderable(renderer, {
    id: "right-col", flexDirection: "column", flexGrow: 1, gap: 1,
  });

  const statusCol = new BoxRenderable(renderer, {
    id: "status-col", borderStyle: "single", borderColor: THEME.border,
    title: " System status ", titleColor: THEME.redSoft,
    flexShrink: 0, flexDirection: "column", alignItems: "stretch", overflow: "hidden",
    backgroundColor: BG_PANEL,
  });
  const statusTexts = Array.from({ length: STATUS_ROWS }, (_, i) =>
    new TextRenderable(renderer, { id: `sl-${i}`, content: "", fg: DIM, width: "100%" })
  );
  statusTexts.forEach((t) => statusCol.add(t));

  const detailCol = new BoxRenderable(renderer, {
    id: "detail-col", borderStyle: "single", borderColor: THEME.border,
    title: " Action details ", titleColor: THEME.redSoft,
    flexGrow: 1, paddingX: 1, alignItems: "stretch", overflow: "hidden",
    backgroundColor: BG_PANEL,
  });
  const detailText = new TextRenderable(renderer, {
    id: "detail-text", content: "", fg: SILVER, width: "100%",
  });
  detailCol.add(detailText);
  let routeScreen: BoxRenderable | null = null;

  rightCol.add(statusCol);
  rightCol.add(detailCol);

  const body = new BoxRenderable(renderer, {
    id: "body", flexDirection: "row", gap: 1, flexGrow: 1,
  });
  body.add(menuCol);
  body.add(rightCol);

  const paneTabs = new TextRenderable(renderer, {
    id: "dashboard-pane-tabs",
    content: "",
    fg: THEME.dim2,
    visible: false,
  });

  const bottomBar = new TextRenderable(renderer, {
    id: "bottom", content: shortcutBar(["↑↓", "navigate"], ["Enter", "select"], ["Q", "quit"]),
    fg: DIM2,
  });

  const dashboard = new BoxRenderable(renderer, {
    id: "dashboard",
    width: "100%",
    height: "100%",
    flexGrow: 1,
    flexDirection: "column",
    padding: 0,
    gap: 1,
  });
  dashboard.add(header);
  dashboard.add(paneTabs);
  dashboard.add(body);
  dashboard.add(bottomBar);

  let lastStatus: ToolkitStatus | null = null;

  // ── Resize: fill the full terminal ──────────────────────────────
  // SelectRenderable needs explicit height; set everything explicitly
  // so nothing is left to guess.
  function updatePaneVisibility(): void {
    paneTabs.visible = narrowLayout;
    menuCol.visible = !narrowLayout || compactPane === "actions";
    rightCol.visible = !narrowLayout || compactPane !== "actions";
    statusCol.visible = !narrowLayout || compactPane === "status";
    detailCol.visible = !narrowLayout || compactPane === "details";
    if (narrowLayout) {
      const tab = (id: CompactPane, label: string) => compactPane === id ? `[${label}]` : ` ${label} `;
      paneTabs.content = `  ${tab("actions", "Actions")}  ${tab("status", "Status")}  ${tab("details", "Details")}    [Tab] switch`;
      bottomBar.content = shortcutBar(["Tab", "view"], ["↑↓", "navigate"], ["Enter", "select"], ["Q", "quit"]);
    } else {
      bottomBar.content = shortcutBar(["↑↓", "navigate"], ["Enter", "select"], ["Q", "quit"]);
    }
  }

  function resize() {
    const H = renderer.height;
    const W = renderer.width;

    // "TwilioWorld" in the "tiny" font is 44 cols; header has 2 border cols
    // + 2 padding cols (paddingX: 1 each side) = 4 cols of overhead, plus a
    // little breathing room so it doesn't sit flush against the border.
    const wide = W >= 92;
    narrowLayout = W < 64;
    const robotMode = wide ? "full" : W >= 72 ? "compact" : "hidden";
    const robotWidth = robotMode === "full" ? 16 : robotMode === "compact" ? 9 : 0;
    banner.visible = wide;
    robot.setMode(robotMode);
    header.title = wide ? "" : " TwilioWorld ";

    const headerH = wide ? 7 : robotMode === "compact" ? 6 : 5;
    const bodyH = Math.max(8, H - headerH - (narrowLayout ? 5 : 3));
    const menuW = narrowLayout ? W : wide ? MENU_W : 30;
    const rightW = narrowLayout ? W : Math.max(24, W - menuW - 1);
    statusContentWidth = Math.max(10, rightW - 2);
    detailContentWidth = Math.max(20, rightW - 4);

    // Explicit sizes — Yoga flexGrow handles width of rightCol,
    // but height needs to be explicit for SelectRenderable.
    body.height = bodyH;
    body.width = W;
    body.flexDirection = "row";
    header.height = headerH;
    header.width = W;

    menuCol.height = bodyH;
    menuCol.width = menuW;
    menuList.height = Math.max(2, bodyH - 2); // subtract borders
    menuList.width  = Math.max(10, menuW - 2);
    rightCol.height = bodyH;
    rightCol.width = rightW;

    // Status box: STATUS_ROWS lines + 2 border
    const statusBoxH = narrowLayout ? bodyH : STATUS_ROWS + 2;
    statusCol.height = statusBoxH;
    statusCol.width  = rightW;

    // Detail fills remaining right col height (gained a panel's worth of
    // space by folding Installed into Status).
    const detailH = narrowLayout ? bodyH : Math.max(4, bodyH - statusBoxH - 1);
    detailCol.height = detailH;
    detailCol.width  = rightW;

    const brandWidth = Math.max(10, W - 4 - robotWidth);
    brand.width = brandWidth;
    titleText.width = brandWidth;
    headline.width = brandWidth;
    nextText.width = brandWidth;
    bottomBar.width = W;
    paneTabs.width = W;
    updatePaneVisibility();
  }

  resize();
  renderer.on("resize", resize);

  // ── Update logic ─────────────────────────────────────────────────
  let lastItems: MenuItem[] = [];

  function refreshHeaderAndAddon(s: ToolkitStatus | null) {
    headline.content = clip(headlineText(s), Math.max(10, renderer.width - 4));
    nextText.content = clip(`› ${nextMove(s)}`, Math.max(10, renderer.width - 4));
  }

  function setDetail(item: MenuItem | undefined, s: ToolkitStatus | null) {
    if (routeScreen) return;
    if (!item || item.id === "exit") {
      detailCol.title = " — ";
      detailText.content = "";
    } else {
      detailCol.title = ` ${item.label(s)} `;
      detailText.content = wrapText(detailFor(item, s), detailContentWidth);
    }
  }

  function update(s: ToolkitStatus | null) {
    lastStatus = s;
    robot.update(s);
    refreshHeaderAndAddon(s);

    const lines = statusLines(s).slice(0, STATUS_ROWS);
    statusTexts.forEach((text, i) => {
      const line = lines[i];
      text.content = line ? clip(line.text, statusContentWidth) : "";
      text.fg = line?.fg ?? DIM;
    });

    const items = visibleItems(s);
    lastItems = items;

    // Preserve selection by id across updates
    const curId = (menuList.options[menuList.getSelectedIndex()]?.value ?? "") as ItemId;
    menuList.options = items.map((m) => ({ name: m.label(s), value: m.id, description: m.detail(s) }));
    const newIdx = items.findIndex((m) => m.id === curId);
    menuList.setSelectedIndex(newIdx >= 0 ? newIdx : Math.min(menuList.getSelectedIndex(), items.length - 1));

    setDetail(items[menuList.getSelectedIndex()], s);
  }

  // Live detail update as user navigates
  menuList.on(SelectRenderableEvents.SELECTION_CHANGED, (idx) => {
    setDetail(lastItems[idx], lastStatus);
  });

  const typedSecret = "twilio";
  const konamiSecret = ["up", "up", "down", "down", "left", "right", "left", "right", "b", "a"];
  let typedBuffer = "";
  let konamiIndex = 0;

  menuList.onKeyDown = (key) => {
    if (key.name === "q") {
      onQuit();
      return;
    }

    typedBuffer = `${typedBuffer}${key.name ?? ""}`.slice(-typedSecret.length);
    if (typedBuffer === typedSecret) {
      typedBuffer = "";
      konamiIndex = 0;
      showRoute(buildInvadersScreen(renderer, backRoute), "Signal Invaders");
      return;
    }

    if (key.name === konamiSecret[konamiIndex]) {
      konamiIndex++;
      if (konamiIndex === konamiSecret.length) {
        typedBuffer = "";
        konamiIndex = 0;
        showRoute(buildInvadersScreen(renderer, backRoute), "Signal Invaders");
      }
    } else {
      konamiIndex = key.name === konamiSecret[0] ? 1 : 0;
    }
  };

  function showRoute(screen: BoxRenderable, title: string) {
    if (routeScreen) {
      detailCol.remove(routeScreen.id);
    } else {
      detailCol.remove("detail-text");
    }
    routeScreen = screen;
    if (narrowLayout) compactPane = "details";
    detailCol.title = ` ${title} `;
    detailCol.add(screen);
    updatePaneVisibility();
    if (screen.focusable) screen.focus();
  }

  function backRoute() {
    robot.react("curious");
    if (routeScreen) {
      detailCol.remove(routeScreen.id);
      routeScreen = null;
      detailCol.add(detailText);
    }
    setDetail(lastItems[menuList.getSelectedIndex()], lastStatus);
    if (narrowLayout) compactPane = "actions";
    updatePaneVisibility();
    menuList.focus();
  }

  const paneOrder: CompactPane[] = ["actions", "status", "details"];
  const paneKeyHandler = (...args: unknown[]) => {
    if (!narrowLayout || routeScreen) return;
    const key = args.find((arg) => arg && typeof arg === "object" && typeof (arg as { name?: unknown }).name === "string") as { name?: string } | undefined;
    if (key?.name !== "tab") return;
    compactPane = paneOrder[(paneOrder.indexOf(compactPane) + 1) % paneOrder.length];
    updatePaneVisibility();
    if (compactPane === "actions") menuList.focus();
  };
  renderer.keyInput.on("keypress", paneKeyHandler);

  menuList.focus();
  return {
    dashboard,
    menuList,
    bottomBar,
    update,
    showRoute,
    backRoute,
    react: robot.react,
    restoreFooter: updatePaneVisibility,
    dispose: () => {
      renderer.off("resize", resize);
      renderer.keyInput.removeListener("keypress", paneKeyHandler);
      robot.dispose();
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  loadToolkitEnv();
  assertInteractiveTerminal();
  assertCompatibleNode();
  assertNotRoot();

  if (process.env.TOOLKIT_TUI_SMOKE === "1") {
    const status = await readStatusAsync();
    console.log("TwilioWorld Agentic Coding Toolkit");
    console.log(headlineText(status));
    for (const line of statusLines(status)) console.log(line.text);
    console.log(`Next: ${nextMove(status)}`);
    return;
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 20,
    screenMode: "alternate-screen",
    externalOutputMode: "passthrough",
    consoleMode: "disabled",
    useKittyKeyboard: null,
    useMouse: false,
    enableMouseMovement: false,
    openConsoleOnError: false,
    backgroundColor: THEME.appBg,
  });
  try { renderer.useMouse = false; } catch { /* ignore */ }

  let interval: ReturnType<typeof setInterval> | null = null;
  let shuttingDown = false;
  let disposeDashboard = () => {};

  function shutdown(code = 0): void {
    if (shuttingDown) return;
    shuttingDown = true;
    if (interval) clearInterval(interval);
    disposeDashboard();
    try { renderer.useMouse = false; } catch { /* ignore */ }
    try { renderer.destroy(); } catch { /* ignore */ }
    forceTerminalRestore();
    setTimeout(() => process.exit(code), 0);
  }

  const { dashboard, menuList, bottomBar, update, showRoute, backRoute, react, restoreFooter, dispose } = buildDashboard(renderer, () => shutdown(0));
  disposeDashboard = dispose;

  let busy = false;

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => shutdown(0));
  }
  process.once("uncaughtException", (e) => {
    try { console.error(e); } finally { shutdown(1); }
  });
  process.once("unhandledRejection", (e) => {
    try { console.error(e); } finally { shutdown(1); }
  });

  let polling = false;
  let latestStatus: ToolkitStatus | null = null;
  async function poll(fresh = false) {
    if (polling) return;
    polling = true;
    try {
      if (fresh) invalidateStatusCache();
      const s = await readStatusAsync({ fresh });
      latestStatus = s;
      update(s);
    } finally {
      polling = false;
    }
  }
  function refreshStatus(delayMs = 0) {
    if (delayMs > 0) setTimeout(() => { void poll(true); }, delayMs);
    else void poll(true);
  }
  function back() { backRoute(); busy = false; refreshStatus(); }

  let flashId = 0;
  function flash(msg: string, color = YELLOW) {
    const id = ++flashId;
    bottomBar.content = `  ${msg}`;
    bottomBar.fg = color;
    react(color === GREEN ? "excited" : color === THEME.danger ? "alert" : "curious");
    setTimeout(() => {
      if (id !== flashId) return;
      restoreFooter();
      bottomBar.fg = DIM2;
    }, 4000);
  }

  // Run a streaming action in a log screen route, then return to dashboard.
  function runAction(
    title: string,
    run: (onLog: (l: string, s: "stdout" | "stderr") => void, onDone: (ok: boolean) => void) => void | Promise<void>,
  ): void {
    busy = true;
    react("thinking");
    showRoute(buildLogScreen(renderer, title, (onLog, onDone) => {
      return run(onLog, (ok) => {
        onDone(ok);
        react(ok ? "excited" : "alert");
        void poll(true);
      });
    }, () => back()), title);
  }

  function startBrowserChat(): void {
    startMcpProxy();
    if (!Boolean(capture("curl", ["-fsS", MODEL_SERVER_URL]))) {
      startDaemon(LLAMAFILE_DEST, serverArgs(), { cwd: ROOT, logFile: MODEL_SERVER_LOG, pidFile: MODEL_SERVER_PID });
      flash(`Starting model server on :${MODEL_SERVER_PORT}…`, GREEN);
      refreshStatus();
      setTimeout(() => { refreshStatus(); openLlamaWebUi(); }, 3000);
      return;
    }
    openLlamaWebUi();
    flash("Opening web UI in your browser", GREEN);
    refreshStatus();
  }

  function showModelControls(): void {
    const reasoningMode = modelReasoningMode();
    showRoute(buildModelControlsScreen(renderer, {
      status: latestStatus,
      reasoningMode,
      onOpenBrowser: startBrowserChat,
      onMissingModel: () => flash("Local model not downloaded — install Local Chat from Components", YELLOW),
      onToggleReasoning: () => {
        const next = nextModelReasoningMode(reasoningMode);
        setModelReasoningMode(next);
        stopModelServer();
        flash(`Response style: ${modelReasoningLabel(next)} — applies on next start`, GREEN);
        refreshStatus();
      },
      onStop: () => {
        const stopped = stopModelServer();
        flash(stopped ? "Model server stopped" : "Nothing was running", stopped ? GREEN : YELLOW);
        refreshStatus();
      },
      onRemove: () => runAction("Remove local model", (onLog, onDone) => runUninstall({ keys: ["modelRuntime"] as UninstallKey[], onLog, onDone })),
      onCancel: back,
    }), "Local AI model");
  }

  menuList.on(SelectRenderableEvents.ITEM_SELECTED, async (_i, opt) => {
    if (busy) return;
    switch (opt.value as ItemId) {
      case "exit": shutdown(0); break;

      case "agent": busy = true; showRoute(buildAgentScreen(renderer, back, back), "Configure Agent"); break;

      case "resources": {
        busy = true;
        showRoute(buildResourcesScreen(renderer, {
          onTwilioWorld: () => {
            const res = openUrl("https://twilio.world");
            flash(res.ok ? "Opening twilio.world in your browser" : `⚠  ${res.error}`, res.ok ? GREEN : YELLOW);
          },
          onDocs: () => {
            const res = openUrl("https://www.twilio.com/docs/ai");
            flash(res.ok ? "Opening twilio.com/docs/ai in your browser" : `⚠  ${res.error}`, res.ok ? GREEN : YELLOW);
          },
          onCancel: back,
        }), "Resources");
        break;
      }

      case "settings": {
        busy = true;
        showRoute(buildSettingsScreen(renderer, {
          onSetup: () => showRoute(buildSetupScreen(renderer, back, back), "Setup"),
          onModelControls: showModelControls,
          onCancel: back,
        }), "Settings");
        break;
      }

      case "chat": {
        busy = true;
        if (latestStatus?.model.ready) {
          showRoute(buildChatScreen(renderer, back), "Chat");
          break;
        }
        showRoute(buildSubmenuScreen(renderer, {
          id: "chat-download-screen",
          route: "Dashboard / Ask Twilio",
          title: "Ask Twilio needs local AI",
          subtitle: `The model downloads once and uses approximately ${LOCAL_MODEL_SIZE_LABEL}.`,
          bodyTitle: "Set up Ask Twilio",
          options: [
            {
              name: "Download local model",
              description: "install the private local model, then return to Ask Twilio",
              onSelect: () => {
                runAction("Download local model", (onLog, onDone) => downloadLocalModel({ onLog, onDone }));
                return false;
              },
            },
            {
              name: "Review Components",
              description: "choose which toolkit components to install",
              onSelect: () => {
                showRoute(buildSetupScreen(renderer, back, back), "Setup");
                return false;
              },
            },
          ],
        }, back), "Ask Twilio setup");
        break;
      }

      case "devphone": {
        busy = true;
        showRoute(buildSubmenuScreen(renderer, {
          id: "devphone-screen",
          route: "Dashboard / Dev Phone",
          title: "Dev Phone",
          subtitle: "Browser soft phone. Escape returns to dashboard.",
	          bodyTitle: "Dev Phone",
	          options: [
	            {
	              name: doneLabel(Boolean(latestStatus?.devPhone.installed), "Open Dev Phone"),
	              description: latestStatus?.devPhone.installed
	                ? "installed — opens in a new window"
	                : latestStatus?.twilio.installed
	                  ? "Dev Phone not installed — install then open"
	                  : "Twilio CLI and Dev Phone not installed — install then open",
	              onSelect: () => {
                if (!have("twilio") || !latestStatus?.devPhone.installed) {
                  runAction("Install Dev Phone", async (onLog, onDone) => {
                    await installDevPhone({ onLog, onDone: () => {} });
                    const res = openDevPhone();
                    if (res.ok) onLog("✓ Dev Phone opened in a new window", "stdout");
                    else onLog(`✗ ${res.error}`, "stderr");
                    onDone(res.ok);
                  });
                  return false;
                }
                const res = openDevPhone();
                flash(res.ok ? "✓  Dev Phone opened in a new window" : `⚠  ${res.error}`, res.ok ? GREEN : YELLOW);
                return true;
              },
	            },
	            {
	              name: "Uninstall Dev Phone",
	              description: latestStatus?.devPhone.installed
	                ? "remove the @twilio-labs/plugin-dev-phone plugin"
	                : "not installed",
	              onSelect: () => {
                runAction("Uninstall Dev Phone", (onLog, onDone) => runUninstall({ keys: ["devPhone"] as UninstallKey[], onLog, onDone }));
                return false;
              },
            },
          ],
        }, back), "Dev Phone");
        break;
      }

      case "cli": {
        busy = true;
        const showCliMenu = () => {
          showRoute(buildSubmenuScreen(renderer, {
            id: "cli-screen",
            route: "Dashboard / Twilio CLI",
            title: "Twilio CLI",
            subtitle: "Terminal, login, switch account, uninstall. Escape returns to dashboard.",
            bodyTitle: "Twilio CLI",
            options: [
	            {
	              name: doneLabel(Boolean(latestStatus?.twilio.installed), "Open a terminal"),
	              description: latestStatus?.twilio.installed
	                ? "toolkit-local Twilio CLI installed — open an isolated terminal"
	                : "toolkit-local Twilio CLI not installed — install then open terminal",
	              onSelect: () => {
                if (!have("twilio")) {
                  runAction("Install Twilio CLI", (onLog, onDone) => installTwilioCli({ onLog, onDone }));
                  return false;
                }
                const res = openTwilioTerminal();
                flash(res.ok ? "✓  Terminal opened" : `⚠  ${res.error}`, res.ok ? GREEN : YELLOW);
                return true;
              },
	            },
	            {
	              name: doneLabel(Boolean(latestStatus?.twilio.sid), "Log in (add an account)"),
	              description: latestStatus?.twilio.sid
	                ? `logged in as ${latestStatus.twilio.profile}`
	                : "run twilio login in a new window",
              onSelect: () => {
                if (!have("twilio")) {
                  runAction("Install Twilio CLI", (onLog, onDone) => installTwilioCli({ onLog, onDone }));
                  return false;
                }
                const res = openTwilioLogin();
                flash(res.ok ? "✓  twilio login opened in a new window" : `⚠  ${res.error}`, res.ok ? GREEN : YELLOW);
                return true;
              },
            },
	            {
	              name: "Switch account",
	              description: latestStatus?.twilio.sid
	                ? `active: ${latestStatus.twilio.profile}`
	                : "choose among this toolkit's isolated Twilio CLI profiles",
              onSelect: () => {
                if (!have("twilio")) { flash("⚠  Toolkit-local Twilio CLI not installed", YELLOW); return true; }
                const profiles = listTwilioProfiles();
                if (profiles.length === 0) { flash("⚠  No profiles — use Log in first", YELLOW); return false; }
                if (profiles.length === 1) { flash(`Only one account: ${profiles[0].id}`, YELLOW); return false; }
                showRoute(buildSubmenuScreen(renderer, {
                  id: "cli-profiles",
                  route: "Dashboard / Twilio CLI / Switch account",
                  title: "Switch Twilio account",
                  subtitle: "Pick the profile to make active. Escape goes back.",
                  bodyTitle: "Accounts",
                  options: profiles.map((p) => ({
                    name: `${p.active ? "● " : "  "}${p.id}`,
                    description: `${p.accountSid}${p.active ? "  (active)" : ""}`,
                    onSelect: () => {
                      if (p.active) { flash(`Already on ${p.id}`, YELLOW); showCliMenu(); return false; }
                      const okSwitched = useTwilioProfile(p.id);
                      flash(okSwitched ? `✓  Switched to ${p.id}` : `⚠  Could not switch to ${p.id}`, okSwitched ? GREEN : YELLOW);
                      refreshStatus();
                      refreshStatus(500);
                      showCliMenu();
                      return false;
                    },
                  })),
                }, showCliMenu), "Switch Twilio account");
                return false;
              },
            },
	            {
	              name: doneLabel(Boolean(latestStatus?.twilio.sid), "Account status"),
	              description: latestStatus?.twilio.sid ? `${latestStatus.twilio.profile} (${latestStatus.twilio.sid})` : "not logged in",
              onSelect: () => {
                if (!have("twilio")) { flash("⚠  Toolkit-local Twilio CLI not installed", YELLOW); return true; }
                flash(latestStatus?.twilio.sid ? `✓  ${latestStatus.twilio.profile} — ${latestStatus.twilio.sid}` : "Not logged in — use Login", latestStatus?.twilio.sid ? GREEN : YELLOW);
                return true;
              },
            },
	            {
	              name: doneLabel(Boolean(process.env.TWILIO_MCP_CREDS), "Enable Execute MCP (read-only)"),
	              description: process.env.TWILIO_MCP_CREDS ? "creds already loaded" : "create a read-only API key so agents can inspect your account",
              onSelect: () => {
                if (!have("twilio")) { flash("⚠  Toolkit-local Twilio CLI not installed", YELLOW); return false; }
                // Restricted-key creation needs the Account SID + Auth Token
                // (the CLI's stored API key can't create keys). Prompt for them.
                showRoute(buildCredsPromptScreen(renderer, {
                  prefillSid: activeAccountSid(),
                  onCancel: showCliMenu,
                  onSubmit: (sid, token) => {
                    runAction("Enable Execute MCP (read-only)", (onLog, onDone) =>
                      setupExecuteMcp({ accountSid: sid, authToken: token, onLog, onDone: (ok) => {
                        // Load the freshly-written creds into this process so
                        // Configure Agent picks up the Execute MCP immediately,
                        // without needing a toolkit restart.
                        if (ok) loadToolkitEnv();
                        onDone(ok);
                      } }));
                  },
                }), "Execute MCP credentials");
                return false;
              },
            },
	            {
	              name: "Uninstall Twilio CLI",
	              description: latestStatus?.twilio.installed ? "remove .toolkit-local Twilio CLI + profiles" : "not installed",
              onSelect: () => {
                runAction("Uninstall Twilio CLI", (onLog, onDone) => runUninstall({ keys: ["twilioCli"] as UninstallKey[], onLog, onDone }));
                return false;
              },
            },
            {
              name: "Delete Execute MCP key",
              description: "remove the twilioworld-toolkit API key + local creds",
              onSelect: () => {
                runAction("Delete Execute MCP key", (onLog, onDone) => runUninstall({ keys: ["apiKey"] as UninstallKey[], onLog, onDone }));
                return false;
              },
            },
            ],
          }, back), "Twilio CLI");
        };
        showCliMenu();
        break;
      }
    }
  });

  // First run uses the same Setup flow available from Settings.
  // Placed here — after poll/back/flash/busy are all initialized — so
  // enterDashboard()'s poll() call never hits a temporal-dead-zone binding.
  function enterDashboard(): void {
    renderer.root.add(dashboard);
    void poll();
    interval = setInterval(poll, POLL_MS);
    menuList.focus();
  }

  if (!existsSync(CONFIG_FILE)) {
    const setup = buildSetupScreen(renderer, () => {
      renderer.root.remove(setup.id);
      enterDashboard();
    }, () => {}, { firstRun: true });
    renderer.root.add(setup);
  } else {
    enterDashboard();
  }

  renderer.on("destroy", () => {
    if (interval) clearInterval(interval);
    forceTerminalRestore();
  });
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    forceTerminalRestore();
    process.exit(1);
  });
}
