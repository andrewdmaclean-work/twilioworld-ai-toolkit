// demo/gui/server.ts — a minimal, REAL functional GUI for the toolkit.
//
// This is not a mock: every route below calls the exact same library
// functions the OpenTUI dashboard uses (tui/src/lib/*). There's no
// OpenTUI dependency in those modules — they just take onLog/onDone
// callbacks — so this server reuses them unchanged and streams their
// output to a browser instead of a terminal.
//
// Run from anywhere (paths resolve relative to this file, not your cwd):
//   bun run demo/gui/server.ts
// Then open:
//   http://localhost:4321
//
// What's real vs. what's simplified:
//   - Reading/saving install choices: 100% real (writes .toolkit/config.json)
//   - Setup:            100% real (runSetup()) — will really download the
//                        model/llamafile if "Local model" is checked, really
//                        copy Skills to ~/.agents/skills if checked, etc.
//   - Configure agent:  100% real (configureAgent())
//   - Status panel:     100% real (readStatusAsync())
//   - No Twilio-login/Execute-MCP-creds flow in this GUI — that's an
//     interactive terminal prompt in the CLI version; wire it here later
//     if you need to demo that specific path.

import { readStatusAsync } from "../../tui/src/status.ts";
import { readConfig, writeConfig, type AddonKey } from "../../tui/src/lib/config.ts";
import { runSetup } from "../../tui/src/lib/setup.ts";
import { configureAgent } from "../../tui/src/lib/configure-agent.ts";

const PORT = Number(process.env.PORT ?? 4321);
const INDEX_HTML = new URL("./index.html", import.meta.url).pathname;

const ALL_ADDONS: AddonKey[] = ["twilioSkills", "docsMcp", "executeMcp", "devPhone", "localGemma", "voiceInput"];

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function sseStream(run: (onLog: (line: string, stream: "stdout" | "stderr") => void, onDone: (ok: boolean) => void) => Promise<void> | void): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const onLog = (line: string, streamName: "stdout" | "stderr") => send({ line, stream: streamName });
      const onDone = (ok: boolean) => {
        send({ done: true, ok });
        controller.close();
      };
      try {
        await run(onLog, onDone);
      } catch (e) {
        send({ line: `error: ${(e as Error).message}`, stream: "stderr" });
        send({ done: true, ok: false });
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/" && req.method === "GET") {
      return new Response(Bun.file(INDEX_HTML), { headers: { "content-type": "text/html" } });
    }

    if (url.pathname === "/api/status" && req.method === "GET") {
      return json(await readStatusAsync());
    }

    if (url.pathname === "/api/config" && req.method === "GET") {
      return json(readConfig());
    }

    if (url.pathname === "/api/config" && req.method === "POST") {
      const body = (await req.json()) as Record<string, boolean>;
      const current = readConfig().addons;
      const merged = { ...current } as Record<AddonKey, boolean>;
      for (const k of ALL_ADDONS) if (typeof body[k] === "boolean") merged[k] = body[k];
      writeConfig(merged);
      return json(readConfig());
    }

    if (url.pathname === "/api/setup" && req.method === "POST") {
      return sseStream((onLog, onDone) => runSetup({ onLog, onDone }));
    }

    if (url.pathname === "/api/configure-agent" && req.method === "POST") {
      const body = (await req.json()) as { agent?: string };
      const agent = body.agent ?? "Other / Bring my own";
      return sseStream((onLog, onDone) => configureAgent({ agent, onLog, onDone }));
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`TwilioWorld Toolkit — demo GUI running at http://localhost:${PORT}`);
