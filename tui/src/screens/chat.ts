import {
  BoxRenderable,
  InputRenderableEvents,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { modelReady, modelRunning, serverArgs } from "../lib/model.ts";
import { LLAMAFILE_DEST, MODEL_SERVER_URL, ROOT } from "../lib/constants.ts";
import { startDaemon } from "../lib/exec.ts";
import { CHAT_TOOLS, runChatTool, type ToolCall } from "../lib/chat-tools.ts";
import {
  cleanupVoiceRecording,
  startVoiceRecording,
  stopVoiceRecording,
  transcribeVoiceFile,
  type VoiceSession,
} from "../lib/voice.ts";
import { THEME } from "../theme.ts";
import { buildEmbeddedRouteChrome } from "./chrome.ts";

type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

interface ChatChoiceMessage {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCall[];
}

const CHAT_URL = MODEL_SERVER_URL.replace(/\/models$/, "/chat/completions");
const MODEL_ID = "gemma4-e2b";

export function isVoiceShortcut(key: { ctrl: boolean; name: string }): boolean {
  return key.ctrl && key.name === "r";
}

function wrap(text: string, width: number): string {
  if (width <= 0) return text;
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw;
    if (!line) {
      lines.push("");
      continue;
    }
    while (line.length > width) {
      let cut = line.lastIndexOf(" ", width);
      if (cut < 16) cut = width;
      lines.push(line.slice(0, cut).trimEnd());
      line = line.slice(cut).trimStart();
    }
    lines.push(line);
  }
  return lines.join("\n");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if (modelRunning()) return true;
    await sleep(500);
  }
  return false;
}

function stripReasoning(text: string): string {
  return text
    .replace(/<\|think\|>[\s\S]*?<\|\/think\|>/g, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

export function plainTextChatResponse(text: string): string {
  return text
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "  ")
    .replace(/^\s*\d+\.\s+/gm, "  ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assistantMessage(payload: unknown): ChatChoiceMessage {
  const obj = payload as {
    choices?: Array<{ message?: ChatChoiceMessage; text?: string }>;
    error?: { message?: string };
  };
  if (obj.error?.message) throw new Error(obj.error.message);
  const message = obj.choices?.[0]?.message;
  if (message) return message;
  return { content: obj.choices?.[0]?.text ?? "" };
}

function trimForModel(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[tool result truncated to ${max} characters]`;
}

export function buildChatScreen(renderer: CliRenderer, onCancel: () => void): BoxRenderable {
  const { screen, body, footer } = buildEmbeddedRouteChrome(renderer, {
    id: "chat-screen",
    route: "Dashboard / Chat",
    title: "Local model chat",
    subtitle: "OpenTUI chat against the local OpenAI-compatible server.",
    bodyTitle: "Conversation",
    footer: "  Enter send    Ctrl+R voice soon    Escape dashboard",
  });

  const transcript = new ScrollBoxRenderable(renderer, {
    id: "chat-transcript",
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
  });

  const inputShell = new BoxRenderable(renderer, {
    id: "chat-input-shell",
    borderStyle: "single",
    borderColor: THEME.redDim,
    title: " Message ",
    titleColor: THEME.red,
    height: 3,
    paddingX: 1,
    backgroundColor: THEME.panelBg,
  });
  const input = new InputRenderable(renderer, {
    id: "chat-input",
    value: "",
    placeholder: "Ask the local model...",
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    textColor: THEME.silver,
    focusedTextColor: THEME.white,
    placeholderColor: THEME.dim2,
  });
  inputShell.add(input);

  body.add(transcript);
  body.add(inputShell);

  const history: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a concise TwilioWorld AI Toolkit assistant.",
        "Do not expose chain-of-thought, hidden reasoning, <think> blocks, or internal deliberation.",
        "Answer in plain text only. Do not use Markdown syntax, headings, bullets, tables, code fences, inline code ticks, bold, or italics.",
        "You have tool calling. For Twilio-specific answers, call search_twilio_skills first. If Skills are missing or not enough, call search_twilio_docs_mcp. If the user explicitly asks for MCP, call search_twilio_docs_mcp.",
        "Use toolkit status/config tools when the user asks about local readiness, selected add-ons, or installed components.",
        "After a tool call, summarize the result plainly and briefly.",
      ].join(" "),
    },
  ];
  let lineId = 0;
  let sending = false;
  let serverReady = false;
  let voiceSession: VoiceSession | null = null;

  function addLine(label: string, content: string, color: string): TextRenderable {
    const line = new TextRenderable(renderer, {
      id: `chat-line-${++lineId}`,
      content: wrap(`${label} ${content}`, Math.max(40, (transcript.width ?? renderer.width) - 8)),
      fg: color,
    });
    transcript.content.add(line);
    return line;
  }

  async function ensureServer(): Promise<boolean> {
    if (serverReady || modelRunning()) {
      serverReady = true;
      return true;
    }
    const ready = modelReady();
    if (!ready.runtime || !ready.weights) {
      footer.content = "  Local model is not ready. Run Setup first.";
      footer.fg = THEME.yellow;
      return false;
    }
    footer.content = "  Starting local model server on :8080...";
    footer.fg = THEME.yellow;
    startDaemon(LLAMAFILE_DEST, serverArgs(), { cwd: ROOT });
    serverReady = await waitForServer();
    footer.content = serverReady
      ? "  Enter send    Escape dashboard    Server :8080 ready"
      : "  Model server did not respond yet. Try again in a moment.";
    footer.fg = serverReady ? THEME.dim : THEME.yellow;
    return serverReady;
  }

  async function sendText(text: string): Promise<void> {
    if (!text || sending) return;
    input.value = "";
    sending = true;
    addLine("You:", text, THEME.white);
    history.push({ role: "user", content: text });

    if (!(await ensureServer())) {
      sending = false;
      input.focus();
      return;
    }

    footer.content = "  Waiting for local model response...";
    footer.fg = THEME.yellow;
    try {
      let reply = "";
      for (let turn = 0; turn < 4; turn++) {
        const res = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer local",
          },
          body: JSON.stringify({
            model: MODEL_ID,
            messages: history,
            tools: CHAT_TOOLS,
            tool_choice: "auto",
            stream: false,
            temperature: 0.2,
            max_tokens: 700,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const message = assistantMessage(await res.json());
        const toolCalls = message.tool_calls ?? [];
        if (!toolCalls.length) {
          reply = plainTextChatResponse(stripReasoning(message.content ?? "")) || "(empty response)";
          break;
        }

        history.push({
          role: "assistant",
          content: plainTextChatResponse(stripReasoning(message.content ?? "")),
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          const toolResult = await runChatTool(call);
          addLine("Tool:", toolResult.name, THEME.cyan);
          history.push({
            role: "tool",
            tool_call_id: call.id,
            name: toolResult.name,
            content: trimForModel(toolResult.result),
          });
        }
      }
      if (!reply) reply = "I called tools, but the local model did not produce a final answer.";
      addLine("Gemma:", reply, THEME.silver);
      history.push({ role: "assistant", content: reply });
      footer.content = "  Enter send    Escape dashboard";
      footer.fg = THEME.dim;
    } catch (e) {
      addLine("Gemma:", (e as Error).message, THEME.yellow);
      footer.content = "  Chat request failed. Check the local model server.";
      footer.fg = THEME.yellow;
    } finally {
      sending = false;
      input.focus();
    }
  }

  async function send(): Promise<void> {
    await sendText(input.value.trim());
  }

  async function toggleVoice(): Promise<void> {
    if (sending) return;
    if (!voiceSession) {
      const started = startVoiceRecording();
      if (!started.ok) {
        addLine("Voice:", started.error, THEME.yellow);
        footer.content = "  Ctrl+R is wired. Voice input is coming soon.";
        footer.fg = THEME.yellow;
        input.focus();
        return;
      }
      voiceSession = started.session;
      addLine("Voice:", `Recording with ${voiceSession.recorder}. Press Ctrl+R to stop.`, THEME.cyan);
      footer.content = "  Recording voice prompt... Ctrl+R stop    Escape dashboard";
      footer.fg = THEME.cyan;
      input.focus();
      return;
    }

    const session = voiceSession;
    voiceSession = null;
    footer.content = "  Transcribing voice prompt...";
    footer.fg = THEME.yellow;
    try {
      await stopVoiceRecording(session);
      const text = (await transcribeVoiceFile(session.file)).trim();
      cleanupVoiceRecording(session);
      if (!text) {
        addLine("Voice:", "No speech detected.", THEME.yellow);
        footer.content = "  Enter send    Ctrl+R voice soon    Escape dashboard";
        footer.fg = THEME.dim;
        return;
      }
      addLine("Voice:", text, THEME.cyan);
      await sendText(text);
    } catch (e) {
      cleanupVoiceRecording(session);
      addLine("Voice:", (e as Error).message, THEME.yellow);
      footer.content = "  Voice transcription failed.";
      footer.fg = THEME.yellow;
    } finally {
      input.focus();
    }
  }

  input.on(InputRenderableEvents.ENTER, () => { void send(); });
  input.onKeyDown = (key) => {
    if (isVoiceShortcut(key)) {
      key.preventDefault();
      key.stopPropagation();
      void toggleVoice();
      return;
    }
    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      if (voiceSession) {
        const session = voiceSession;
        voiceSession = null;
        void stopVoiceRecording(session).then(() => cleanupVoiceRecording(session));
      }
      onCancel();
    }
  };

  addLine("System:", "Local chat stays inside OpenTUI. The server starts in the background if needed. Ctrl+R voice input is wired and coming soon.", THEME.dim2);
  void ensureServer();
  input.focus();
  return screen;
}
