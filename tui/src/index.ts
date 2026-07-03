// index.ts — TwilioWorld AI Toolkit TUI
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
import { buildSetupScreen } from "./screens/setup.ts";
import { buildAgentScreen } from "./screens/agent.ts";
import { buildChatScreen } from "./screens/chat.ts";
import { buildUninstallScreen } from "./screens/uninstall.ts";
import { buildInvadersScreen } from "./screens/invaders.ts";
import {
  LLAMAFILE_DEST, ROOT, MODEL_SERVER_URL,
} from "./lib/constants.ts";
import { serverArgs, modelReady } from "./lib/model.ts";
import { openInNewWindow, openUrl, capture, have, startDaemon } from "./lib/exec.ts";
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
    console.error("TwilioWorld AI Toolkit requires an interactive terminal for OpenTUI.");
    console.error("Run ./toolkit from a real terminal window, not through a pipe, task runner output panel, or dumb terminal.");
    process.exit(2);
  }
}

function assertCompatibleNode(): void {
  if (process.env.TOOLKIT_TUI_SMOKE === "1") return;
  const nodeInfo = pathNodeVersion();
  if (!supportsPiNode(nodeInfo)) {
    console.error("TwilioWorld AI Toolkit requires Node >= 22.19.0 on PATH.");
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
    console.error("TwilioWorld AI Toolkit should not be run as root.");
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
  if (!s.model.ready && s.addons.localGemma) return "Run Setup to download the local Gemma model and llamafile runtime.";
  if (s.addons.executeMcp && !process.env.TWILIO_MCP_CREDS) return "Export TWILIO_MCP_CREDS before using Execute MCP.";
  if (s.model.ready && !s.model.running) return "Start Model server, then Chat with Twilio or Configure an agent.";
  return "Choose Setup to change install choices or Configure agent to wire up any agent.";
}

function headlineText(s: ToolkitStatus | null): string {
  const model = s?.model.running ? "model online" : s?.addons.localGemma ? (s.model.ready ? "model ready" : "model missing") : "";
  const twilio = s?.twilio.sid ? `Twilio ${s.twilio.profile}` : "Twilio not logged in";
  return [model, twilio].filter(Boolean).join("  |  ");
}

function addonLine(s: ToolkitStatus | null): string {
  if (!s) return "Install choices loading";
  return `Install choices  ${selectedAddons(s)}`;
}

// ── Status panel lines (left-col) ───────────────────────────────────
function statusLines(s: ToolkitStatus | null) {
  if (!s) return [{ text: "  ·  Checking local status...", fg: DIM }];

  const ok  = (l: string, v: string) => ({ text: `  ✓  ${l.padEnd(12)} ${v}`, fg: GREEN });
  const lines = [];

  if (s.model.running) lines.push(ok("Local model", "running on :8080"));
  if (process.env.TWILIO_MCP_CREDS) lines.push(ok("Execute MCP", "creds loaded"));

  return lines.length ? lines : [{ text: "  ·  No running toolkit services.", fg: DIM2 }];
}

// ── Menu definition ──────────────────────────────────────────────────
type ItemId = "chat"|"server"|"devphone"|"setup"|"agent"|"signup"|"uninstall"|"exit";

interface MenuItem {
  id: ItemId;
  label: (s: ToolkitStatus | null) => string;
  detail: (s: ToolkitStatus | null) => string;
  visible: (s: ToolkitStatus) => boolean;
}

const ALL_ITEMS: MenuItem[] = [
  { id: "chat",
    label: () => "Chat with Twilio",
    detail: () => "interactive chat + OpenAI API on :8080",
    visible: (s) => s.model.ready },

  { id: "server",
    label: (s) => s?.model.running ? "Model server   ✓ :8080" : "Model server",
    detail: (s) => s?.model.running ? "running on :8080" : "headless API server for tools",
    visible: (s) => s.model.ready },

  { id: "devphone",
    label: () => "Dev Phone",
    detail: () => "browser soft phone — real SMS + voice",
    visible: (s) => s.addons.devPhone === true || s.devPhone.installed },

  { id: "setup",
    label: () => "Setup",
    detail: () => "choose what this toolkit installs or wires into agents",
    visible: () => true },

  { id: "agent",
    label: () => "Configure agent",
    detail: () => "wire Skills + MCP servers into any agent — Pi, OpenCode, Claude Code, Cursor, Codex",
    visible: () => true },

  { id: "signup",
    label: () => "Sign up for TwilioWorld",
    detail: () => "open twilio.world in your browser",
    visible: () => true },

  { id: "uninstall",
    label: () => "Uninstall",
    detail: () => "choose exactly what to remove from this machine",
    visible: () => true },

  { id: "exit",
    label: () => "Exit",
    detail: () => "",
    visible: () => true },
];

function visibleItems(s: ToolkitStatus | null): MenuItem[] {
  if (!s) return ALL_ITEMS.filter((m) => ["setup","agent","signup","uninstall","exit"].includes(m.id));
  return ALL_ITEMS.filter((m) => m.visible(s));
}

function yesNo(v: boolean): string {
  return v ? "yes" : "no";
}

function selectedAddons(s: ToolkitStatus | null): string {
  if (!s) return "loading";
  const names: Array<[string, string]> = [
    ["localGemma", "Local chat model"],
    ["twilioSkills", "Agent Skills"],
    ["docsMcp", "Agent Docs MCP"],
    ["executeMcp", "Agent Execute MCP"],
    ["devPhone", "Dev Phone"],
  ];
  const enabled = names.filter(([k]) => s.addons[k]).map(([, name]) => name);
  return enabled.length ? enabled.join(", ") : "none";
}

function detailFor(item: MenuItem | undefined, s: ToolkitStatus | null): string {
  if (!item || item.id === "exit") return "";
  switch (item.id) {
    case "setup":
      return [
        "Purpose",
        "  Choose what to install locally and what to wire into coding agents.",
        "",
        "Current choices",
        `  ${selectedAddons(s)}`,
        "",
        "Touches",
        "  .toolkit/config.json",
        "  tools/ and models/ when local chat model is selected",
        "  ~/.agents/skills/ when agent Skills are selected",
        "",
        "Network installs/downloads happen only after the confirmation step.",
      ].join("\n");
    case "agent":
      return [
        "Purpose",
        "  Wire the selected skills and MCP servers into whichever coding agent you pick.",
        "  If the toolkit knows how to launch that agent (currently: Pi), it opens it",
        "  in a new terminal window when setup finishes.",
        "",
        "Inputs",
        `  Install Twilio Skills for agents: ${yesNo(Boolean(s?.addons.twilioSkills))}`,
        `  Add Docs MCP to agents: ${yesNo(Boolean(s?.addons.docsMcp))}`,
        `  Add Execute MCP to agents: ${yesNo(Boolean(s?.addons.executeMcp))}`,
        `  Execute creds exported: ${yesNo(Boolean(process.env.TWILIO_MCP_CREDS))}`,
      ].join("\n");
    case "chat":
      return [
        "Purpose",
        "  Chat with Twilio inside OpenTUI using the local Gemma model.",
        "",
        "Uses",
        `  Runtime ready: ${yesNo(Boolean(s?.model.runtimeReady))}`,
        `  Weights ready: ${yesNo(Boolean(s?.model.fileReady))}`,
        `  Twilio Skills: ${yesNo((s?.skills.count ?? 0) > 0)} (always used by local chat)`,
        "  Docs MCP: yes (always used by local chat)",
        `  Already running: ${yesNo(Boolean(s?.model.running))}`,
        "",
        "Gemma is required for this local chat. The model server starts in the background if needed.",
      ].join("\n");
    case "server":
      return [
        "Purpose",
        "  Start the local model API in the background for tools and agents.",
        "",
        "Uses",
        `  Runtime ready: ${yesNo(Boolean(s?.model.runtimeReady))}`,
        `  Weights ready: ${yesNo(Boolean(s?.model.fileReady))}`,
        `  Endpoint: ${MODEL_SERVER_URL}`,
        `  Running now: ${yesNo(Boolean(s?.model.running))}`,
      ].join("\n");
    case "devphone":
      return [
        "Purpose",
        "  Open Twilio Dev Phone from the Twilio CLI.",
        "",
        "Uses",
        `  Twilio CLI installed: ${yesNo(Boolean(s?.twilio.installed))}`,
        `  Logged in: ${yesNo(Boolean(s?.twilio.sid))}`,
        "",
        "Use a spare Twilio number. Dev Phone can overwrite number webhooks.",
      ].join("\n");
    case "uninstall":
      return [
        "Purpose",
        "  Remove selected toolkit-installed pieces from this machine.",
        "",
        "Choose from",
        "  * Dev Phone plugin",
        "  * Toolkit-created API key",
        "  * Global Twilio CLI",
        "  * Twilio/SendGrid skills installed for agents",
        "  * Local toolkit copy of Twilio Skills",
        "  * Local .toolkit state and Execute MCP creds",
        "  * Downloaded local model/runtime files",
        "",
        "Nothing is removed until you check items and confirm. Twilio logout is never run.",
      ].join("\n");
    case "signup":
      return [
        "Purpose",
        "  Open the TwilioWorld signup page in your browser.",
        "",
        "Destination",
        "  https://twilio.world",
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
    title: " TwilioWorld AI Toolkit ",
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

  const addonCol = new BoxRenderable(renderer, {
    id: "addon-col", borderStyle: "single", borderColor: RED_DIM,
    title: " Install Choices ", titleColor: RED,
    flexShrink: 0, paddingX: 1,
    backgroundColor: BG_PANEL,
  });
  const addonText = new TextRenderable(renderer, {
    id: "addon-text",
    content: addonLine(null),
    fg: SILVER,
  });
  addonCol.add(addonText);

  const statusCol = new BoxRenderable(renderer, {
    id: "status-col", borderStyle: "single", borderColor: RED_DIM,
    title: " Active ", titleColor: RED,
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

  rightCol.add(addonCol);
  rightCol.add(statusCol);
  rightCol.add(detailCol);

  const body = new BoxRenderable(renderer, {
    id: "body", flexDirection: "row", gap: 1, flexGrow: 1,
  });
  body.add(menuCol);
  body.add(rightCol);

  const bottomBar = new TextRenderable(renderer, {
    id: "bottom", content: "  ↑/↓ or j/k navigate    Enter run    Setup changes install choices    q quit",
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
    header.title = wide ? "" : " TwilioWorld AI Toolkit ";

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

    const addonBoxH = 3;
    addonCol.height = addonBoxH;
    addonCol.width = rightW;
    addonText.content = clip(addonLine(lastStatus), Math.max(10, rightW - 4));

    // Status box: STATUS_ROWS lines + 2 border
    const statusBoxH = STATUS_ROWS + 2;
    statusCol.height = statusBoxH;
    statusCol.width  = rightW;

    // Detail fills remaining right col height
    const detailH = Math.max(4, bodyH - addonBoxH - statusBoxH - 2); // gaps
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
    addonText.content = clip(addonLine(s), Math.max(10, (addonCol.width ?? renderer.width) - 4));
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
  assertInteractiveTerminal();
  assertCompatibleNode();
  assertNotRoot();

  if (process.env.TOOLKIT_TUI_SMOKE === "1") {
    const status = await readStatusAsync();
    console.log("TwilioWorld AI Toolkit");
    console.log(headlineText(status));
    console.log(addonLine(status));
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
  renderer.root.add(dashboard);

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
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      update(await readStatusAsync());
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
      bottomBar.content = "  ↑/↓ or j/k navigate    Enter run    Setup changes install choices    q quit";
      bottomBar.fg = DIM;
    }, 4000);
  }

  menuList.on(SelectRenderableEvents.ITEM_SELECTED, async (_i, opt) => {
    if (busy) return;
    switch (opt.value as ItemId) {
      case "exit":   shutdown(0); break;
      case "setup":  busy = true; showRoute(buildSetupScreen(renderer, back, back), "Setup"); break;
      case "agent":  busy = true; showRoute(buildAgentScreen(renderer, back, back), "Configure Agent"); break;
      case "signup": {
        const res = openUrl("https://twilio.world");
        flash(res.ok ? "Opening twilio.world in your browser" : `⚠  ${res.error}`, res.ok ? GREEN : YELLOW);
        break;
      }
      case "uninstall": busy = true; showRoute(buildUninstallScreen(renderer, back, back), "Uninstall"); break;

      case "chat": {
        const { runtime, weights } = modelReady();
        if (!runtime || !weights) { flash("⚠  Local model not ready — run Setup"); break; }
        busy = true;
        showRoute(buildChatScreen(renderer, back), "Chat");
        break;
      }

      case "server": {
        const { runtime, weights } = modelReady();
        if (!runtime || !weights) { flash("⚠  Local model not ready — run Setup"); break; }
        if (Boolean(capture("curl", ["-fsS", MODEL_SERVER_URL]))) {
          flash("✓  Server already running on :8080", GREEN); break;
        }
        startDaemon(LLAMAFILE_DEST, serverArgs(), { cwd: ROOT });
        flash("Starting model server on :8080", GREEN);
        setTimeout(() => { poll(); }, 3000);
        break;
      }

      case "devphone": {
        if (!have("twilio")) { flash("⚠  Twilio CLI not installed — run Setup"); break; }
        const res = openInNewWindow("twilio", ["dev-phone"], { cwd: ROOT });
        flash(res.ok ? "✓  Dev Phone opened in a new window" : `⚠  ${res.error}`, res.ok ? GREEN : YELLOW);
        break;
      }
    }
  });

  void poll();
  interval = setInterval(poll, POLL_MS);
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
