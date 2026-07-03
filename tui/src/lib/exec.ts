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
import { existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

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

/** Non-interactive command; stdout/stderr streamed line-by-line to onLog. */
export function runStreaming(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; onLog: LogFn },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", shCmd(command, args)], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let outRest = "";
    let errRest = "";
    child.stdout.on("data", (d: Buffer) => {
      const s = outRest + d.toString();
      const parts = s.split(/\r?\n/);
      outRest = parts.pop() ?? "";
      parts.forEach((l) => { if (l) opts.onLog(l, "stdout"); });
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = errRest + d.toString();
      const parts = s.split(/\r?\n/);
      errRest = parts.pop() ?? "";
      parts.forEach((l) => { if (l) opts.onLog(l, "stderr"); });
    });
    child.on("error", (e: Error) => { opts.onLog(`error: ${e.message}`, "stderr"); });
    child.on("close", (code: number | null) => {
      if (outRest) opts.onLog(outRest, "stdout");
      if (errRest) opts.onLog(errRest, "stderr");
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
  const res = spawnSync("/bin/sh", ["-c", shCmd(command, args)], {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
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
    const openers = ["xdg-open", "gio"];
    for (const opener of openers) {
      if (!have(opener)) continue;
      const args = opener === "gio" ? ["open", url] : [url];
      spawn(opener, args, { stdio: "ignore", detached: true }).unref();
      return { ok: true };
    }
    return { ok: false, error: "No browser opener found. Visit https://twilio.world manually." };
  } catch (e) {
    return { ok: false, error: `Could not open https://twilio.world: ${(e as Error).message}` };
  }
}

/** export lines for any env entries this call adds/overrides vs. the
 *  current process env — the new terminal's login shell already has
 *  everything else. */
/** export lines for env vars the new shell needs. The target is a
 *  brand-new Terminal.app/login shell, NOT a fork of this process, so
 *  nothing is inherited automatically — its rc files (~/.zshrc etc.) run
 *  first and can set up a *different* PATH than this process has (e.g.
 *  nvm's default alias instead of whatever `nvm use` picked for the
 *  shell that launched the toolkit). PATH is therefore always exported
 *  explicitly, even when it matches this process's env, so the new shell
 *  resolves the same node/pi/etc. binaries this process already
 *  validated. Other vars only get exported when they differ. */
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
  const env = opts.env ?? process.env;
  const inner = shCmd(command, args);

  if (process.platform === "darwin") return openMacTerminal(inner, cwd, env);
  if (process.platform === "win32") return openWindowsTerminal(inner, cwd, env);
  return openLinuxTerminal(inner, cwd, env);
}

/** Long-running background daemon in its own process group. */
export function startDaemon(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): ChildProcess {
  const child = spawn("/bin/sh", ["-c", shCmd(command, args)], {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  return child;
}

/** True if a binary is on PATH.
 *  NOTE: synchronous (blocks the event loop, and OpenTUI's render/input
 *  loop, for the duration of the subprocess). Fine for one-off calls
 *  triggered by a menu selection; use haveAsync() for anything on a
 *  polling/background path. */
export function have(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore", shell: "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}

/** Capture stdout of a quick command. Returns "" on failure.
 *  NOTE: synchronous — see have() above for why that matters. Use
 *  captureAsync() for anything on a polling/background path. */
export function capture(command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  try {
    const res = spawnSync("/bin/sh", ["-c", shCmd(command, args)], {
      encoding: "utf8",
      env: env ?? process.env,
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
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/** Non-blocking sibling of capture(). See haveAsync() for why this
 *  matters — this is the primitive readStatusAsync() uses so status
 *  polling never freezes the TUI. */
export function captureAsync(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", shCmd(command, args)], {
      env: env ?? process.env,
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
