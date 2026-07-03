import { capture, captureAsync } from "./exec.ts";

export interface NodeVersionInfo {
  raw: string;
  major: number;
  minor: number;
  patch: number;
}

export function parseNodeVersion(raw: string): NodeVersionInfo | null {
  const match = raw.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    raw: raw.trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function pathNodeVersion(): NodeVersionInfo | null {
  return parseNodeVersion(capture("node", ["--version"]));
}

/** Non-blocking sibling of pathNodeVersion() — use on polling/background
 *  paths so a `node --version` spawn never freezes the TUI. */
export async function pathNodeVersionAsync(): Promise<NodeVersionInfo | null> {
  return parseNodeVersion(await captureAsync("node", ["--version"]));
}

export function supportsPiNode(version: NodeVersionInfo | null): boolean {
  if (!version) return false;
  return version.major > 22 || (version.major === 22 && version.minor >= 19);
}

export function pathNodeSupportsPi(): boolean {
  return supportsPiNode(pathNodeVersion());
}
