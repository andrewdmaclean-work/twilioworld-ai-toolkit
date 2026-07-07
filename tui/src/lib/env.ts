// lib/env.ts — load .toolkit/.env into process.env at startup.
//
// setupExecuteMcp() writes TWILIO_MCP_CREDS to .toolkit/.env (chmod 600,
// gitignored) as `export KEY="value"` lines. Nothing sources that file for
// the TUI process, so without this the creds are written but never visible
// to the running toolkit — agent config would keep skipping the Execute MCP
// until the user manually `source`d the file. Loading it here makes the
// creds persist across launches and take effect immediately after creation.
//
// Values already present in process.env win (an explicit shell export or a
// `source .toolkit/.env` before launch is not overridden).

import { existsSync, readFileSync } from "fs";
import { ENV_FILE } from "./constants.ts";

/** Parse `export KEY="value"` / `KEY=value` lines and set them on
 *  process.env if not already set. Returns the keys it loaded. */
export function loadToolkitEnv(): string[] {
  if (!existsSync(ENV_FILE)) return [];
  const loaded: string[] = [];
  try {
    for (const raw of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      // Strip a single layer of matching surrounding quotes.
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = val;
        loaded.push(key);
      }
    }
  } catch { /* best-effort */ }
  return loaded;
}
