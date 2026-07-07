// lib/exec.ts — command execution primitives for the TUI.
//
// Four shapes:
//
//   runStreaming()     — non-interactive command; stdout/stderr streamed
//                        line-by-line to a callback (→ log pane). Uses
//                        /bin/sh so APE binaries and npm shebangs resolve.
//
//   runTakeover()      — interactive program that takes over the full
//                        terminal in-place. Caller MUST renderer.suspend()
//                        before and renderer.resume() after. Not currently
//                        used by the menu (Pi/Dev Phone open in a new
//                        window instead, see openInNewWindow), kept as a
//                        primitive for same-window takeover if ever needed.
//
//   openInNewWindow()  — interactive program launched in a brand-new
//                        terminal window (Pi, Dev Phone), fully detached
//                        from this process. The TUI keeps running normally;
//                        no suspend/resume needed.
//
//   startDaemon()      — long-running background process, own process group.

import { spawn, spawnSync, type ChildProcess } from "child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { delimiter, dirname, join } from "path";
import {
  MCP_PROXY_PID,
  MCP_PROXY_PORT,
  MCP_PROXY_SCRIPT,
  MODEL_SERVER_PID,
  MODEL_SERVER_PORT,
  NPM_GLOBAL_PREFIX,
  TOOLKIT_BIN_DIRS,
  TWILIO_CLI_HOME,
} from "./constants.ts";

export type LogFn = (line: string, stream: "stdout" | "stderr") => void;

export interface RunResult {
  code: number;
  ok: boolean;
}

/** Shell-quote a single argument (single-quote wrapping). */
function q(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Build a /bin/sh -c invocation string from command + args. */
function shCmd(command: string, args: string[]): string {
  return [command, ...args].map(q).join(" ");
}

const TOOLKIT_LOCAL_ONLY_BINS = new Set(["bun", "node", "npm", "npx", "twilio", "pi"]);

function commandNames(bin: string): string[] {
  return process.platform === "win32"
    ? [bin, `${bin}.cmd`, `${bin}.exe`, `${bin}.ps1`]
    : [bin];
}

function localCommandPath(bin: string): string {
  for (const dir of TOOLKIT_BIN_DIRS) {
    for (const name of commandNames(bin)) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function commandForSpawn(command: string): string | null {
  if (!TOOLKIT_LOCAL_ONLY_BINS.has(command)) return command;
  return localCommandPath(command) || null;
}

export function toolkitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const currentPath = extra.PATH ?? process.env.PATH ?? "";
  return {
    ...process.env,
    ...extra,
    PATH: [...TOOLKIT_BIN_DIRS, currentPath].filter(Boolean).join(delimiter),
    npm_config_prefix: extra.npm_config_prefix ?? process.env.npm_config_prefix ?? NPM_GLOBAL_PREFIX,
    NPM_CONFIG_PREFIX: extra.NPM_CONFIG_PREFIX ?? process.env.NPM_CONFIG_PREFIX ?? NPM_GLOBAL_PREFIX,
  };
}

export function twilioCliEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = toolkitEnv(extra);
  mkdirSync(TWILIO_CLI_HOME, { recursive: true });
  return {
    ...env,
    HOME: TWILIO_CLI_HOME,
    USERPROFILE: TWILIO_CLI_HOME,
    XDG_CONFIG_HOME: join(TWILIO_CLI_HOME, ".config"),
    XDG_CACHE_HOME: join(TWILIO_CLI_HOME, ".cache"),
    XDG_DATA_HOME: join(TWILIO_CLI_HOME, ".local", "share"),
    XDG_STATE_HOME: join(TWILIO_CLI_HOME, ".local", "state"),
  };
}

function commandEnv(command: string, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return command === "twilio" ? twilioCliEnv(extra) : toolkitEnv(extra);
}

function stripTerminalControls(text: string): string {
  let clean = text
    // OSC/title sequences.
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    // CSI and common ANSI escape sequences.
    .replace(/[\x1B\x9B][[\]()#;?]*(?:(?:[0-9A-Za-z]*(?:;[0-9A-Za-z]*)*)?\x07|(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nq-uy=><~])/g, "")
    // Other C0 controls except backspace, newline, carriage return, and tab.
    .replace(/[\x00-\x07\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Some package-manager progress renderers use backspace to redraw a line.
  // Collapse "x\b" pairs before the append-only log sees them.
  while (/[^\n\r]\x08/.test(clean)) clean = clean.replace(/[^\n\r]\x08/g, "");
  return clean;
}

function latestCarriageReturnFrame(line: string): string {
  const parts = line.split("\r");
  return parts[parts.length - 1] ?? "";
}

function streamChunk(
  rest: string,
  data: Buffer,
  stream: "stdout" | "stderr",
  onLog: LogFn,
): string {
  const text = stripTerminalControls(rest + data.toString());
  const parts = text.split("\n");
  const nextRest = latestCarriageReturnFrame(parts.pop() ?? "");
  for (const raw of parts) {
    const line = latestCarriageReturnFrame(raw).trimEnd();
    if (line) onLog(line, stream);
  }
  return nextRest;
}

/** Non-interactive command; stdout/stderr streamed line-by-line to onLog. */
export function runStreaming(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; onLog: LogFn },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const resolved = commandForSpawn(command);
    if (!resolved) {
      opts.onLog(`${command} is not installed in this toolkit environment.`, "stderr");
      resolve({ code: 127, ok: false });
      return;
    }
    const child = spawn("/bin/sh", ["-c", shCmd(resolved, args)], {
      cwd: opts.cwd,
      env: commandEnv(command, opts.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let outRest = "";
    let errRest = "";
    child.stdout.on("data", (d: Buffer) => {
      outRest = streamChunk(outRest, d, "stdout", opts.onLog);
    });
    child.stderr.on("data", (d: Buffer) => {
      errRest = streamChunk(errRest, d, "stderr", opts.onLog);
    });
    child.on("error", (e: Error) => { opts.onLog(`error: ${e.message}`, "stderr"); });
    child.on("close", (code: number | null) => {
      if (outRest.trim()) opts.onLog(latestCarriageReturnFrame(outRest).trimEnd(), "stdout");
      if (errRest.trim()) opts.onLog(latestCarriageReturnFrame(errRest).trimEnd(), "stderr");
      resolve({ code: code ?? 1, ok: code === 0 });
    });
  });
}

/** Interactive program that takes over the terminal. Blocks until exit.
 *  Caller MUST renderer.suspend() before and renderer.resume() after.
 *  Routes through /bin/sh -c to handle APE binaries and npm shebangs. */
export function runTakeover(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const resolved = commandForSpawn(command);
  if (!resolved) return { code: 127, ok: false };
  const res = spawnSync("/bin/sh", ["-c", shCmd(resolved, args)], {
    cwd: opts.cwd,
    env: commandEnv(command, opts.env),
    stdio: "inherit",
  });
  return { code: res.status ?? 1, ok: res.status === 0 };
}

export interface NewWindowResult {
  ok: boolean;
  error?: string;
}

export function openUrl(url: string): NewWindowResult {
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
      return { ok: true };
    }
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
      return { ok: true };
    }
    if (!process.env.DISPLAY) {
      return { ok: false, error: "No DISPLAY found. Open quicklinks from a terminal inside the VNC desktop." };
    }
    const openers = ["chromium-launch", "xdg-open", "gio", "sensible-browser", "epiphany-browser", "chromium", "chromium-browser"];
    for (const opener of openers) {
      if (!have(opener)) continue;
      const args = opener === "gio" ? ["open", url] : [url];
      spawn(opener, args, { stdio: "ignore", detached: true }).unref();
      return { ok: true };
    }
    return { ok: false, error: `No browser opener found. Visit ${url} manually.` };
  } catch (e) {
    return { ok: false, error: `Could not open ${url}: ${(e as Error).message}` };
  }
}

/** export lines for any env entries this call adds/overrides vs. the
 *  current process env — the new terminal's login shell already has
 *  everything else. */
/** export lines for env vars the new shell needs. The target is a
 *  brand-new Terminal.app/login shell, NOT a fork of this process, so
 *  nothing is inherited automatically — its rc files (~/.zshrc etc.) run
 *  first and can set up a *different* PATH than this process has. PATH is
 *  therefore always exported explicitly, even when it matches this process's env, so the new shell
 *  resolves the same toolkit-local node/npm/twilio/pi/etc. binaries this
 *  process already validated. Other vars only get exported when they differ. */
function envExportLines(env: NodeJS.ProcessEnv): string[] {
  const lines: string[] = [];
  if (env.PATH) lines.push(`export PATH=${q(env.PATH)}`);
  for (const [k, v] of Object.entries(env)) {
    if (k === "PATH" || v === undefined || process.env[k] === v) continue;
    lines.push(`export ${k}=${q(v)}`);
  }
  return lines;
}

function openMacTerminal(inner: string, cwd: string, env: NodeJS.ProcessEnv): NewWindowResult {
  try {
    const file = join(tmpdir(), `twilioworld-launch-${Date.now()}-${Math.random().toString(36).slice(2)}.command`);
    const script = [
      "#!/bin/sh",
      `cd ${q(cwd)}`,
      ...envExportLines(env),
      inner,
      `rm -f -- ${q(file)}`, // self-cleanup once the foreground command exits
      "",
    ].join("\n");
    writeFileSync(file, script, { mode: 0o755 });
    // `open` hands the .command file to Terminal.app, which runs it in a
    // brand-new window and returns immediately — this process never blocks.
    spawn("open", [file], { stdio: "ignore", detached: true }).unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not open Terminal: ${(e as Error).message}` };
  }
}

const LINUX_TERMINALS: Array<{ bin: string; args: (cmd: string) => string[] }> = [
  { bin: "gnome-terminal", args: (cmd) => ["--", "/bin/sh", "-c", cmd] },
  { bin: "konsole", args: (cmd) => ["-e", "/bin/sh", "-c", cmd] },
  { bin: "xfce4-terminal", args: (cmd) => ["-e", `/bin/sh -c ${q(cmd)}`] },
  { bin: "x-terminal-emulator", args: (cmd) => ["-e", `/bin/sh -c ${q(cmd)}`] },
  { bin: "xterm", args: (cmd) => ["-e", `/bin/sh -c ${q(cmd)}`] },
];

function openLinuxTerminal(inner: string, cwd: string, env: NodeJS.ProcessEnv): NewWindowResult {
  const full = [`cd ${q(cwd)}`, ...envExportLines(env), inner].join(" && ");
  for (const t of LINUX_TERMINALS) {
    if (!have(t.bin)) continue;
    try {
      spawn(t.bin, t.args(full), { stdio: "ignore", detached: true }).unref();
      return { ok: true };
    } catch {
      // try the next terminal emulator
    }
  }
  return {
    ok: false,
    error: "No supported terminal emulator found (tried gnome-terminal, konsole, xfce4-terminal, x-terminal-emulator, xterm).",
  };
}

function openWindowsTerminal(inner: string, cwd: string, env: NodeJS.ProcessEnv): NewWindowResult {
  const full = [`cd /d ${cwd}`, ...envExportLines(env).map((l) => l.replace(/^export /, "set ")), inner].join(" && ");
  try {
    const useWt = have("wt.exe") || have("wt");
    const args = useWt
      ? ["/c", "wt", "cmd", "/k", full]
      : ["/c", "start", "TwilioWorld", "cmd", "/k", full];
    spawn("cmd.exe", args, { stdio: "ignore", detached: true, env }).unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not open a new console window: ${(e as Error).message}` };
  }
}

/** Launch an interactive program in a brand-new terminal window, fully
 *  detached from this process. Returns immediately — the TUI keeps
 *  running normally, no renderer.suspend()/resume() needed. Best-effort:
 *  if no terminal emulator can be found, returns { ok: false, error }
 *  so the caller can tell the user to run the command manually. */
export function openInNewWindow(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): NewWindowResult {
  const cwd = opts.cwd ?? process.cwd();
  const env = commandEnv(command, opts.env);
  const resolved = commandForSpawn(command);
  if (!resolved) return { ok: false, error: `${command} is not installed in this toolkit environment.` };
  const inner = shCmd(resolved, args);

  if (process.platform === "darwin") return openMacTerminal(inner, cwd, env);
  if (process.platform === "win32") return openWindowsTerminal(inner, cwd, env);
  return openLinuxTerminal(inner, cwd, env);
}

/** Long-running background daemon in its own process group. */
export function startDaemon(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; logFile?: string; pidFile?: string } = {},
): ChildProcess {
  let logFd: number | undefined;
  if (opts.logFile) {
    mkdirSync(dirname(opts.logFile), { recursive: true });
    logFd = openSync(opts.logFile, "w");
  }
  const resolved = commandForSpawn(command);
  if (!resolved) throw new Error(`${command} is not installed in this toolkit environment.`);
  const child = spawn("/bin/sh", ["-c", shCmd(resolved, args)], {
    cwd: opts.cwd,
    env: commandEnv(command, opts.env),
    stdio: logFd === undefined ? "ignore" : ["ignore", logFd, logFd],
    detached: true,
  });
  if (logFd !== undefined) closeSync(logFd);
  if (opts.pidFile && child.pid) {
    mkdirSync(dirname(opts.pidFile), { recursive: true });
    writeFileSync(opts.pidFile, `${child.pid}\n`, { mode: 0o600 });
  }
  child.unref();
  return child;
}

/** True if a binary is on PATH.
 *  NOTE: synchronous (blocks the event loop, and OpenTUI's render/input
 *  loop, for the duration of the subprocess). Fine for one-off calls
 *  triggered by a menu selection; use haveAsync() for anything on a
 *  polling/background path. */
export function have(bin: string): boolean {
  if (TOOLKIT_LOCAL_ONLY_BINS.has(bin)) return Boolean(localCommandPath(bin));
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore", shell: "/bin/sh", env: toolkitEnv() });
    return true;
  } catch {
    return false;
  }
}

/** Capture stdout of a quick command. Returns "" on failure.
 *  NOTE: synchronous — see have() above for why that matters. Use
 *  captureAsync() for anything on a polling/background path. */
export function capture(command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const resolved = commandForSpawn(command);
  if (!resolved) return "";
  try {
    const res = spawnSync("/bin/sh", ["-c", shCmd(resolved, args)], {
      encoding: "utf8",
      env: commandEnv(command, env),
    });
    return (res.stdout ?? "").trim();
  } catch {
    return "";
  }
}

/** Non-blocking sibling of have(). Runs the subprocess off the main
 *  thread via libuv, so OpenTUI keeps rendering and handling input (and
 *  any in-flight chat fetch keeps streaming) while this is pending. */
export function haveAsync(bin: string): Promise<boolean> {
  if (TOOLKIT_LOCAL_ONLY_BINS.has(bin)) return Promise.resolve(Boolean(localCommandPath(bin)));
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", `command -v ${bin}`], { stdio: "ignore", env: toolkitEnv() });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/** Non-blocking sibling of capture(). See haveAsync() for why this
 *  matters — this is the primitive readStatusAsync() uses so status
 *  polling never freezes the TUI. */
export function captureAsync(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const resolved = commandForSpawn(command);
  if (!resolved) return Promise.resolve("");
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", shCmd(resolved, args)], {
      env: commandEnv(command, env),
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out.trim()));
  });
}

export function fileExecutable(path: string): boolean {
  try { return existsSync(path); } catch { return false; }
}

/**
 * Kill the running llamafile model server and the MCP proxy bridge if running.
 * Uses toolkit-owned PID files so unrelated llamafile processes are left alone.
 * Returns true if a llamafile process was found and signalled.
 */
export function killModelServer(): boolean {
  // Also stop the proxy bridge — it's always started/stopped with the server.
  killMcpProxy();
  return killPidFile(MODEL_SERVER_PID);
}

/**
 * Start the HTTP→HTTPS MCP proxy bridge as a background daemon.
 * Kills any existing instance first so restarts are clean.
 * The bridge is a plain Node.js script (tools/mcp-proxy.js) with no
 * npm dependencies — it uses only built-in http/https modules.
 */
export function startMcpProxy(): void {
  if (!existsSync(MCP_PROXY_SCRIPT)) return;
  killMcpProxy(); // evict any leftover from a previous run
  startDaemon("node", [MCP_PROXY_SCRIPT, "https://mcp.twilio.com/docs", String(MCP_PROXY_PORT)], { pidFile: MCP_PROXY_PID });
}

function killMcpProxy(): void {
  killPidFile(MCP_PROXY_PID);
}

function pidFromFile(pidFile: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

function killPidFile(pidFile: string): boolean {
  const pid = pidFromFile(pidFile);
  if (!pid) return false;
  try {
    if (process.platform === "win32") {
      const res = spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
      rmSync(pidFile, { force: true });
      return res.status === 0;
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
    rmSync(pidFile, { force: true });
    return true;
  } catch {
    rmSync(pidFile, { force: true });
    return false;
  }
}

/**
 * Open the llama.cpp web UI in the browser.
 *
 * The Twilio Docs MCP server and system message are seeded server-side via
 * llamafile's --ui-config-file (see serverArgs() in model.ts), so there's
 * nothing to inject client-side — just open the page.
 */
export function openLlamaWebUi(port = Number(MODEL_SERVER_PORT)): NewWindowResult {
  return openUrl(`http://127.0.0.1:${port}/`);
}
