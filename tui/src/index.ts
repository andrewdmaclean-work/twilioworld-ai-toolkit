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

import { readStatusAsync, type ToolkitStatus } from "./status.ts";
import { existsSync } from "fs";
import { buildAgentScreen } from "./screens/agent.ts";
import { buildChatScreen } from "./screens/chat.ts";
import { buildSubmenuScreen } from "./screens/submenu.ts";
import { buildLogScreen } from "./screens/log.ts";
import { buildOnboardingScreen } from "./screens/onboarding.ts";
import {
  downloadLocalModel, installDevPhone, installTwilioCli,
  openDevPhone, openTwilioLogin, openTwilioTerminal, stopModelServer,
  setupExecuteMcp, listTwilioProfiles, useTwilioProfile, activeAccountSid,
} from "./lib/actions.ts";
import { buildCredsPromptScreen } from "./screens/creds-prompt.ts";
import { loadToolkitEnv } from "./lib/env.ts";
import { runUninstall, type UninstallKey } from "./lib/uninstall.ts";
import { buildInvadersScreen } from "./screens/invaders.ts";
import {
  LLAMAFILE_DEST, ROOT, MODEL_SERVER_URL, CONFIG_FILE,
} from "./lib/constants.ts";
import { serverArgs, modelReady } from "./lib/model.ts";
import { openUrl, openLlamaWebUi, startMcpProxy, capture, have, startDaemon } from "./lib/exec.ts";
import { pathNodeVersion, supportsPiNode } from "./lib/node-version.ts";

// ── Palette ──────────────────────────────────────────────────────────
const RED      = "#F22F46";
const RED_DIM  = "#5C0013";
const WHITE    = "#FFFFFF";
const SILVER   = "#CCCCCC";
const DIM      = "#4A4A5A";
const DIM2     = "#777777";
const BG_SEL   = "#3D000E";
const GREEN    = "#22C55E";
const YELLOW   = "#F59E0B";
const CYAN      = "#38BDF8";
const BG_PANEL  = "#08080B";
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
    console.error("TwilioWorld Agentic Coding Toolkit requires Node >= 22.19.0 on PATH.");
    console.error(`Current node is ${nodeInfo?.raw ?? "not found"}. Run: nvm install 22 && nvm use 22`);
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
  if (!s.model.ready) return "Chat with Twilio Docs will download the local model (~2.5GB) on first use.";
  if (!s.twilio.installed) return "Twilio CLI opens/installs from the Twilio CLI menu when you need it.";
  return "Chat with Twilio Docs, Configure an agent, or open Dev Phone.";
}

function headlineText(s: ToolkitStatus | null): string {
  const model = s?.model.running ? "model online" : s?.model.ready ? "model ready" : "model not downloaded";
  const twilio = s?.twilio.sid ? `Twilio ${s.twilio.profile}` : "Twilio not logged in";
  return [model, twilio].filter(Boolean).join("  |  ");
}

// ── Status panel lines — installed + running, only what's present ────
function statusLines(s: ToolkitStatus | null) {
  if (!s) return [{ text: "  ·  Checking local status...", fg: DIM }];

  const ok   = (l: string, v: string) => ({ text: `  ✓  ${l.padEnd(13)} ${v}`, fg: GREEN });
  const idle = (l: string, v: string) => ({ text: `  ·  ${l.padEnd(13)} ${v}`, fg: DIM2 });
  const lines: Array<{ text: string; fg: string }> = [];

  // Running now (green).
  if (s.model.running) lines.push(ok("Local model", "running on :8080"));
  if (process.env.TWILIO_MCP_CREDS) lines.push(ok("Execute MCP", "creds loaded"));

  // Installed but idle (dim) — only shown when present, no dashes for absent.
  if (s.model.ready && !s.model.running) lines.push(idle("Local model", "downloaded, not running"));
  if (s.twilio.sid) lines.push(idle("Twilio", `${s.twilio.profile}`));
  else if (s.twilio.installed) lines.push(idle("Twilio CLI", "installed, not logged in"));
  if (s.devPhone.installed) lines.push(idle("Dev Phone", "installed"));
  if ((s.skills.installedCount ?? 0) > 0) lines.push(idle("Skills", `${s.skills.installedCount} for agents`));

  return lines.length ? lines : [{ text: "  ·  Nothing installed yet. Pick an action to begin.", fg: DIM2 }];
}

// ── Menu definition ──────────────────────────────────────────────────
type ItemId = "chat"|"agent"|"devphone"|"cli"|"resources"|"exit";

interface MenuItem {
  id: ItemId;
  label: (s: ToolkitStatus | null) => string;
  detail: (s: ToolkitStatus | null) => string;
  visible: (s: ToolkitStatus) => boolean;
}

const ALL_ITEMS: MenuItem[] = [
  { id: "chat",
    label: () => "Chat with Twilio Docs",
    detail: () => "local AI chat — in the TUI or the browser web UI",
    visible: () => true },

  { id: "agent",
    label: () => "Configure agent",
    detail: () => "wire Skills + Docs MCP into Pi, Claude Code, Cursor, Codex, OpenCode, Copilot",
    visible: () => true },

  { id: "devphone",
    label: () => "Dev Phone",
    detail: () => "browser soft phone — real SMS + voice",
    visible: () => true },

  { id: "cli",
    label: () => "Twilio CLI",
    detail: () => "open a terminal, log in, check account, or uninstall",
    visible: () => true },

  { id: "resources",
    label: () => "Resources",
    detail: () => "TwilioWorld signup and Twilio AI Docs",
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
  return v ? "yes" : "no";
}

function detailFor(item: MenuItem | undefined, s: ToolkitStatus | null): string {
  if (!item || item.id === "exit") return "";
  switch (item.id) {
    case "chat":
      return [
        "Purpose",
        "  Chat with Twilio Docs using the local Gemma model — in this TUI or",
        "  in the llama.cpp web UI in your browser. Both use Twilio Docs MCP.",
        "",
        "Local model (required for chat)",
        `  Runtime ready: ${yesNo(Boolean(s?.model.runtimeReady))}`,
        `  Weights ready: ${yesNo(Boolean(s?.model.fileReady))}`,
        `  Running now: ${yesNo(Boolean(s?.model.running))}`,
        "",
        s?.model.ready
          ? "Ready. Enter to choose TUI or browser."
          : "Not downloaded yet — Enter offers to download it (~2.5GB).",
      ].join("\n");
    case "agent":
      return [
        "Purpose",
        "  Wire Twilio Skills + Docs MCP into whichever coding agent you pick,",
        "  then launch it. Pi is installed + launched for you; others get wired.",
        "",
        "Always wired",
        "  Twilio Skills + Docs MCP (no auth, no config needed)",
        "",
        "Execute MCP (calls real Twilio APIs)",
        `  Wired only if creds are exported: ${yesNo(Boolean(process.env.TWILIO_MCP_CREDS))}`,
      ].join("\n");
    case "devphone":
      return [
        "Purpose",
        "  Browser soft phone — send/receive real SMS and voice with no device.",
        "",
        "Status",
        `  Twilio CLI installed: ${yesNo(Boolean(s?.twilio.installed))}`,
        `  Dev Phone installed: ${yesNo(Boolean(s?.devPhone.installed))}`,
        `  Logged in: ${yesNo(Boolean(s?.twilio.sid))}`,
        "",
        "Enter installs it if needed, then opens it. Use a spare number —",
        "Dev Phone can overwrite a number's webhooks.",
      ].join("\n");
    case "cli":
      return [
        "Purpose",
        "  Twilio CLI hub — open a terminal, log in, check your account, or",
        "  uninstall the CLI.",
        "",
        "Status",
        `  Installed: ${yesNo(Boolean(s?.twilio.installed))}`,
        s?.twilio.sid ? `  Account: ${s.twilio.profile} (${s.twilio.sid})` : "  Not logged in",
      ].join("\n");
    case "resources":
      return [
        "Purpose",
        "  Open a Twilio resource in your browser.",
        "",
        "Choose from",
        "  * Sign up for TwilioWorld — https://twilio.world",
        "  * Twilio AI Docs — https://www.twilio.com/docs/ai",
      ].join("\n");
  }
}

// ── Dashboard factory ────────────────────────────────────────────────
function buildDashboard(renderer: CliRenderer, onQuit: () => void) {
  const STATUS_ROWS = 7; // number of status lines

  // ── Widgets ─────────────────────────────────────────────────────
  const header = new BoxRenderable(renderer, {
    id: "header",
    borderStyle: "double",
    borderColor: RED,
    title: " TwilioWorld Agentic Coding Toolkit ",
    titleColor: WHITE,
    paddingX: 1,
    flexDirection: "column",
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
  header.add(banner);
  header.add(titleText);
  header.add(headline);
  header.add(nextText);

  // Left column: menu
  const MENU_W = 36;
  const menuCol = new BoxRenderable(renderer, {
    id: "menu-col", borderStyle: "single", borderColor: RED_DIM,
    title: " Actions ", titleColor: RED,
    width: MENU_W, flexShrink: 0,
    backgroundColor: BG_PANEL,
  });
  const menuList = new SelectRenderable(renderer, {
    id: "menu-list",
    width: MENU_W - 2, height: 10, // overridden by resize()
    options: [],
    backgroundColor: "transparent", focusedBackgroundColor: "transparent",
    textColor: SILVER, focusedTextColor: SILVER,
    selectedBackgroundColor: BG_SEL, selectedTextColor: WHITE,
    descriptionColor: DIM2, selectedDescriptionColor: SILVER,
    showScrollIndicator: false, showDescription: false,
  });
  menuCol.add(menuList);

  // Right column: status + detail
  const rightCol = new BoxRenderable(renderer, {
    id: "right-col", flexDirection: "column", flexGrow: 1, gap: 1,
  });

  const statusCol = new BoxRenderable(renderer, {
    id: "status-col", borderStyle: "single", borderColor: RED_DIM,
    title: " Status ", titleColor: RED,
    flexShrink: 0, flexDirection: "column",
    backgroundColor: BG_PANEL,
  });
  const statusTexts = Array.from({ length: STATUS_ROWS }, (_, i) =>
    new TextRenderable(renderer, { id: `sl-${i}`, content: "", fg: DIM })
  );
  statusTexts.forEach((t) => statusCol.add(t));

  const detailCol = new BoxRenderable(renderer, {
    id: "detail-col", borderStyle: "single", borderColor: RED_DIM,
    title: " Selected Action ", titleColor: RED,
    flexGrow: 1, paddingX: 1,
    backgroundColor: BG_PANEL,
  });
  const detailText = new TextRenderable(renderer, {
    id: "detail-text", content: "", fg: SILVER,
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

  const bottomBar = new TextRenderable(renderer, {
    id: "bottom", content: "  ↑/↓ or j/k navigate    Enter select    q quit",
    fg: DIM,
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
  dashboard.add(body);
  dashboard.add(bottomBar);

  let lastStatus: ToolkitStatus | null = null;

  // ── Resize: fill the full terminal ──────────────────────────────
  // SelectRenderable needs explicit height; set everything explicitly
  // so nothing is left to guess.
  function resize() {
    const H = renderer.height;
    const W = renderer.width;

    // "TwilioWorld" in the "tiny" font is 44 cols; header has 2 border cols
    // + 2 padding cols (paddingX: 1 each side) = 4 cols of overhead, plus a
    // little breathing room so it doesn't sit flush against the border.
    const BANNER_MIN_WIDTH = 44 + 4 + 8;
    const wide = W >= BANNER_MIN_WIDTH;
    banner.visible = wide;
    header.title = wide ? "" : " TwilioWorld Agentic Coding Toolkit ";

    const headerH = wide ? 7 : 5; // 2 banner rows + 3 text rows + 2 border, vs. 3 text rows + 2 border
    const bodyH = Math.max(8, H - headerH - 2);
    const rightW = Math.max(20, W - MENU_W - 1); // 1 = gap between columns

    // Explicit sizes — Yoga flexGrow handles width of rightCol,
    // but height needs to be explicit for SelectRenderable.
    body.height = bodyH;
    body.width = W;
    header.height = headerH;
    header.width = W;

    menuCol.height = bodyH;
    menuList.height = Math.max(2, bodyH - 2); // subtract borders
    menuList.width  = MENU_W - 2;

    // Status box: STATUS_ROWS lines + 2 border
    const statusBoxH = STATUS_ROWS + 2;
    statusCol.height = statusBoxH;
    statusCol.width  = rightW;

    // Detail fills remaining right col height (gained a panel's worth of
    // space by folding Installed into Status).
    const detailH = Math.max(4, bodyH - statusBoxH - 1); // 1 gap
    detailCol.height = detailH;
    detailCol.width  = rightW;

    titleText.width = Math.max(10, W - 4);
    headline.width = Math.max(10, W - 4);
    nextText.width = Math.max(10, W - 4);
    bottomBar.width = W;
  }

  resize();
  renderer.on("resize", resize);

  // ── Update logic ─────────────────────────────────────────────────
  let lastItems: MenuItem[] = [];

  function refreshHeaderAndAddon(s: ToolkitStatus | null) {
    headline.content = clip(headlineText(s), Math.max(10, renderer.width - 4));
    nextText.content = clip(`Next: ${nextMove(s)}`, Math.max(10, renderer.width - 4));
  }

  function setDetail(item: MenuItem | undefined, s: ToolkitStatus | null) {
    if (routeScreen) return;
    if (!item || item.id === "exit") {
      detailCol.title = " — ";
      detailText.content = "";
    } else {
      detailCol.title = ` ${item.label(s)} `;
      detailText.content = wrapText(detailFor(item, s), Math.max(20, (detailCol.width ?? 80) - 4));
    }
  }

  function update(s: ToolkitStatus | null) {
    lastStatus = s;
    refreshHeaderAndAddon(s);

    const lines = statusLines(s).slice(0, STATUS_ROWS);
    statusTexts.forEach((text, i) => {
      const line = lines[i];
      text.content = line ? clip(line.text, Math.max(10, (statusCol.width ?? renderer.width) - 2)) : "";
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
    detailCol.title = ` ${title} `;
    detailCol.add(screen);
    if (screen.focusable) screen.focus();
  }

  function backRoute() {
    if (routeScreen) {
      detailCol.remove(routeScreen.id);
      routeScreen = null;
      detailCol.add(detailText);
    }
    setDetail(lastItems[menuList.getSelectedIndex()], lastStatus);
    menuList.focus();
  }

  menuList.focus();
  return { dashboard, menuList, bottomBar, update, showRoute, backRoute };
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
    backgroundColor: "#050507",
  });
  try { renderer.useMouse = false; } catch { /* ignore */ }

  let interval: ReturnType<typeof setInterval> | null = null;
  let shuttingDown = false;

  function shutdown(code = 0): void {
    if (shuttingDown) return;
    shuttingDown = true;
    if (interval) clearInterval(interval);
    try { renderer.useMouse = false; } catch { /* ignore */ }
    try { renderer.destroy(); } catch { /* ignore */ }
    forceTerminalRestore();
    setTimeout(() => process.exit(code), 0);
  }

  const { dashboard, menuList, bottomBar, update, showRoute, backRoute } = buildDashboard(renderer, () => shutdown(0));

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
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const s = await readStatusAsync();
      latestStatus = s;
      update(s);
    } finally {
      polling = false;
    }
  }
  function back() { backRoute(); busy = false; poll(); }

  let flashId = 0;
  function flash(msg: string, color = YELLOW) {
    const id = ++flashId;
    bottomBar.content = `  ${msg}`;
    bottomBar.fg = color;
    setTimeout(() => {
      if (id !== flashId) return;
      bottomBar.content = "  ↑/↓ or j/k navigate    Enter select    q quit";
      bottomBar.fg = DIM;
    }, 4000);
  }

  // Run a streaming action in a log screen route, then return to dashboard.
  function runAction(
    title: string,
    run: (onLog: (l: string, s: "stdout" | "stderr") => void, onDone: (ok: boolean) => void) => void | Promise<void>,
  ): void {
    busy = true;
    showRoute(buildLogScreen(renderer, title, run, () => back()), title);
  }

  menuList.on(SelectRenderableEvents.ITEM_SELECTED, async (_i, opt) => {
    if (busy) return;
    switch (opt.value as ItemId) {
      case "exit": shutdown(0); break;

      case "agent": busy = true; showRoute(buildAgentScreen(renderer, back, back), "Configure Agent"); break;

      case "resources": {
        busy = true;
        showRoute(buildSubmenuScreen(renderer, {
          id: "resources-screen",
          route: "Dashboard / Resources",
          title: "Resources",
          subtitle: "Open a Twilio resource in your browser. Escape returns to dashboard.",
          bodyTitle: "Resources",
          options: [
            {
              name: "Sign up for TwilioWorld",
              description: "open twilio.world in your browser",
              onSelect: () => {
                const res = openUrl("https://twilio.world");
                flash(res.ok ? "Opening twilio.world in your browser" : `⚠  ${res.error}`, res.ok ? GREEN : YELLOW);
                return true;
              },
            },
            {
              name: "Twilio AI Docs",
              description: "open twilio.com/docs/ai in your browser",
              onSelect: () => {
                const res = openUrl("https://www.twilio.com/docs/ai");
                flash(res.ok ? "Opening twilio.com/docs/ai in your browser" : `⚠  ${res.error}`, res.ok ? GREEN : YELLOW);
                return true;
              },
            },
          ],
        }, back), "Resources");
        break;
      }

      case "chat": {
        busy = true;
        // Local Gemma is the only way to chat. If it isn't downloaded,
        // the submenu's actions offer to download it instead of dead-ending.
        const ready = () => { const r = modelReady(); return r.runtime && r.weights; };

        const startBrowser = () => {
          startMcpProxy();
          if (!Boolean(capture("curl", ["-fsS", MODEL_SERVER_URL]))) {
            startDaemon(LLAMAFILE_DEST, serverArgs(), { cwd: ROOT });
            flash("Starting model server on :8080…", GREEN);
            setTimeout(() => { poll(); openLlamaWebUi(); }, 3000);
          } else {
            openLlamaWebUi();
            flash("Opening web UI in your browser", GREEN);
          }
        };

        showRoute(buildSubmenuScreen(renderer, {
          id: "chat-screen",
          route: "Dashboard / Chat with Twilio Docs",
          title: "Chat with Twilio Docs",
          subtitle: "Local AI chat. Escape returns to dashboard.",
          bodyTitle: "Chat",
          options: [
            {
              name: "In the TUI",
              description: "chat inside this terminal (Twilio Skills + Docs MCP)",
              onSelect: () => {
                if (!ready()) {
                  runAction("Download local model", (onLog, onDone) => downloadLocalModel({ onLog, onDone }));
                  return false;
                }
                showRoute(buildChatScreen(renderer, back), "Chat");
                return false;
              },
            },
            {
              name: "In the browser (web UI)",
              description: "open the llama.cpp web UI, pre-wired to Twilio Docs MCP",
              onSelect: () => {
                if (!ready()) {
                  runAction("Download local model", (onLog, onDone) => downloadLocalModel({ onLog, onDone }));
                  return false;
                }
                startBrowser();
                return true;
              },
            },
            {
              name: "Stop background model server",
              description: "reclaim RAM — stops llamafile + MCP proxy on :8080",
              onSelect: () => {
                const stopped = stopModelServer();
                flash(stopped ? "✓  Model server stopped" : "⚠  Nothing was running", stopped ? GREEN : YELLOW);
                setTimeout(() => poll(), 500);
                return true;
              },
            },
            {
              name: "Remove local model",
              description: "delete downloaded Gemma + llamafile (~2.5GB)",
              onSelect: () => {
                runAction("Remove local model", (onLog, onDone) => runUninstall({ keys: ["modelRuntime"] as UninstallKey[], onLog, onDone }));
                return false;
              },
            },
          ],
        }, back), "Chat with Twilio Docs");
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
              name: "Open Dev Phone",
              description: "installs it first if needed, then opens in a new window",
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
              description: "remove the @twilio-labs/plugin-dev-phone plugin",
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
              name: "Open a terminal",
              description: "new window with the Twilio CLI on PATH",
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
              name: "Log in (add an account)",
              description: "run twilio login in a new window",
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
              description: "choose among your configured Twilio CLI profiles",
              onSelect: () => {
                if (!have("twilio")) { flash("⚠  Twilio CLI not installed", YELLOW); return true; }
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
                      setTimeout(() => poll(), 500);
                      showCliMenu();
                      return false;
                    },
                  })),
                }, showCliMenu), "Switch Twilio account");
                return false;
              },
            },
            {
              name: "Account status",
              description: latestStatus?.twilio.sid ? `${latestStatus.twilio.profile} (${latestStatus.twilio.sid})` : "not logged in",
              onSelect: () => {
                if (!have("twilio")) { flash("⚠  Twilio CLI not installed", YELLOW); return true; }
                flash(latestStatus?.twilio.sid ? `✓  ${latestStatus.twilio.profile} — ${latestStatus.twilio.sid}` : "Not logged in — use Login", latestStatus?.twilio.sid ? GREEN : YELLOW);
                return true;
              },
            },
            {
              name: "Enable Execute MCP (read-only)",
              description: process.env.TWILIO_MCP_CREDS ? "creds already loaded" : "create a read-only API key so agents can inspect your account",
              onSelect: () => {
                if (!have("twilio")) { flash("⚠  Twilio CLI not installed", YELLOW); return false; }
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
              description: "npm uninstall -g twilio-cli",
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

  // First run (no .toolkit/config.json yet) → opinionated onboarding first;
  // it writes config when finished so later launches skip to the dashboard.
  // Placed here — after poll/back/flash/busy are all initialized — so
  // enterDashboard()'s poll() call never hits a temporal-dead-zone binding.
  function enterDashboard(): void {
    renderer.root.add(dashboard);
    void poll();
    interval = setInterval(poll, POLL_MS);
    menuList.focus();
  }

  if (!existsSync(CONFIG_FILE)) {
    const onboarding = buildOnboardingScreen(renderer, () => {
      renderer.root.remove(onboarding.id);
      enterDashboard();
    });
    renderer.root.add(onboarding);
  } else {
    enterDashboard();
  }

  renderer.on("destroy", () => {
    if (interval) clearInterval(interval);
    forceTerminalRestore();
  });
}

main().catch((e) => {
  console.error(e);
  forceTerminalRestore();
  process.exit(1);
});
