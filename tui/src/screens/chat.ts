import {
  BoxRenderable,
  InputRenderableEvents,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { MODEL_SERVER_LOG, modelReady, modelRunning, modelStartupStatus, serverArgs, waitForModelServer } from "../lib/model.ts";
import { LLAMAFILE_DEST, MODEL_SERVER_PID, MODEL_SERVER_PORT, MODEL_SERVER_URL, ROOT } from "../lib/constants.ts";
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

type StreamToolCall = ToolCall & { index?: number };

const CHAT_URL = MODEL_SERVER_URL.replace(/\/models$/, "/chat/completions");
const MODEL_ID = "gemma4-e2b";

export function isVoiceShortcut(key: { ctrl: boolean; name: string }): boolean {
  return key.ctrl && key.name === "r";
}

// The text input keeps keyboard focus permanently in this screen (there's no
// separate "focus the transcript to scroll" mode), so these navigation keys
// are intercepted here and forwarded to the transcript's own ScrollBox key
// handling instead of being typed into the input. PageUp/PageDown/Home/End
// always scroll the transcript — an empty single-line input has no use for
// them. Up/Down only scroll when the input is empty, so they don't fight
// with any future in-input cursor/history behavior while you're typing.
const SCROLL_KEYS_ALWAYS = new Set(["pageup", "pagedown", "home", "end"]);
const SCROLL_KEYS_WHEN_EMPTY = new Set(["up", "down"]);

export function isTranscriptScrollKey(key: { name: string }, inputEmpty: boolean): boolean {
  return SCROLL_KEYS_ALWAYS.has(key.name) || (inputEmpty && SCROLL_KEYS_WHEN_EMPTY.has(key.name));
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

function visibleAssistantText(text: string): string {
  return plainTextChatResponse(stripReasoning(text
    .replace(/<\|think\|>[\s\S]*?(?:<\|\/think\|>|$)/g, "")
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/g, "")));
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

function mergeToolCall(target: StreamToolCall, delta: StreamToolCall): void {
  if (delta.id) target.id = delta.id;
  if (delta.type) target.type = delta.type;
  const fn = delta.function;
  if (!fn) return;
  target.function = target.function ?? {};
  if (fn.name) target.function.name = `${target.function.name ?? ""}${fn.name}`;
  if (fn.arguments) target.function.arguments = `${target.function.arguments ?? ""}${fn.arguments}`;
}

async function streamChatCompletion(
  messages: ChatMessage[],
  onVisibleText: (text: string) => void,
): Promise<ChatChoiceMessage> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local",
    },
    body: JSON.stringify({
      model: MODEL_ID,
      messages,
      tools: CHAT_TOOLS,
      tool_choice: "auto",
      stream: true,
      temperature: 0.2,
      max_tokens: 700,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) return assistantMessage(await res.json());

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls: StreamToolCall[] = [];
  let content = "";
  let reasoningContent = "";
  let buffer = "";

  function handlePayload(raw: string): void {
    if (!raw || raw === "[DONE]") return;
    const chunk = JSON.parse(raw) as {
      error?: { message?: string };
      choices?: Array<{
        text?: string;
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: StreamToolCall[];
        };
        message?: ChatChoiceMessage;
      }>;
    };
    if (chunk.error?.message) throw new Error(chunk.error.message);
    const choice = chunk.choices?.[0];
    if (!choice) return;

    if (choice.message) {
      content += choice.message.content ?? "";
      reasoningContent += choice.message.reasoning_content ?? "";
      for (const call of choice.message.tool_calls ?? []) {
        const index = (call as StreamToolCall).index ?? toolCalls.length;
        toolCalls[index] = call;
      }
    }

    const text = choice.delta?.content ?? choice.text ?? "";
    if (text) {
      content += text;
      onVisibleText(visibleAssistantText(content));
    }
    if (choice.delta?.reasoning_content) reasoningContent += choice.delta.reasoning_content;
    for (const call of choice.delta?.tool_calls ?? []) {
      const index = call.index ?? toolCalls.length;
      toolCalls[index] = toolCalls[index] ?? { id: "", type: "function", function: {} };
      mergeToolCall(toolCalls[index], call);
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      handlePayload(trimmed.slice(5).trim());
    }
  }
  if (buffer.trim().startsWith("data:")) handlePayload(buffer.trim().slice(5).trim());

  return {
    content,
    reasoning_content: reasoningContent,
    tool_calls: toolCalls.filter((call) => call.function?.name || call.function?.arguments),
  };
}

export function buildChatScreen(renderer: CliRenderer, onCancel: () => void): BoxRenderable {
  const { screen, body, footer } = buildEmbeddedRouteChrome(renderer, {
    id: "chat-screen",
    route: "Dashboard / Chat",
    title: "Chat with Twilio Docs",
    subtitle: "Local AI chat, grounded in Twilio Skills and Docs MCP.",
    bodyTitle: "Conversation",
    footer: "  Enter send    PageUp/PageDown scroll    Escape dashboard",
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
        "You are a concise TwilioWorld Agentic Coding Toolkit assistant.",
        "Do not expose chain-of-thought, hidden reasoning, <think> blocks, or internal deliberation.",
        "Answer in plain text only. Do not use Markdown syntax, headings, bullets, tables, code fences, inline code ticks, bold, or italics.",
        "You have tool calling. Local chat always has Twilio Skills and Docs MCP available. For Twilio-specific answers, call search_twilio_skills first. If Skills are missing or not enough, call search_twilio_docs_mcp. If the user explicitly asks for MCP, call search_twilio_docs_mcp.",
        "Use toolkit status/config tools when the user asks about local status, install choices, or installed components.",
        "After a tool call, summarize the result plainly and briefly.",
      ].join(" "),
    },
  ];
  let lineId = 0;
  let sending = false;
  let serverReady = false;
  let serverStarting: Promise<boolean> | null = null;
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

  function updateLine(line: TextRenderable, label: string, content: string): void {
    line.content = wrap(`${label} ${content}`, Math.max(40, (transcript.width ?? renderer.width) - 8));
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
    if (!serverStarting) {
      footer.content = `  Starting local model server on :${MODEL_SERVER_PORT}...`;
      footer.fg = THEME.yellow;
      addLine("System:", `Starting local model server on :${MODEL_SERVER_PORT}. Logs: ${MODEL_SERVER_LOG}`, THEME.dim2);
      startDaemon(LLAMAFILE_DEST, serverArgs(), { cwd: ROOT, logFile: MODEL_SERVER_LOG, pidFile: MODEL_SERVER_PID });
      serverStarting = waitForModelServer({
        timeoutSeconds: 90,
        onTick: (elapsed, status) => {
          footer.content = `  Loading local model on :${MODEL_SERVER_PORT} (${elapsed}s elapsed) — ${status}`;
          footer.fg = THEME.yellow;
        },
      });
      void serverStarting.then((ok) => {
        if (!ok) addLine("System:", `Model server did not respond after 90s. Last status: ${modelStartupStatus()}.`, THEME.yellow);
      });
    } else {
      footer.content = `  Waiting for model server on :${MODEL_SERVER_PORT}...`;
      footer.fg = THEME.yellow;
    }
    serverReady = await serverStarting;
    if (!serverReady) serverStarting = null;
    footer.content = serverReady
      ? `  Enter send    PageUp/PageDown scroll    Server :${MODEL_SERVER_PORT} ready`
      : `  Model server did not respond after 90s. See ${MODEL_SERVER_LOG}`;
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

    footer.content = "  Sending prompt to local model...";
    footer.fg = THEME.yellow;
    try {
      let reply = "";
      let wroteReply = false;
      for (let turn = 0; turn < 4; turn++) {
        let streamed = "";
        let firstTextAt = 0;
        const startedAt = Date.now();
        const assistantLine = addLine("Gemma:", "working...", THEME.silver);
        footer.content = turn === 0
          ? "  Prompt processing locally..."
          : "  Tool result sent — summarizing locally...";
        const message = await streamChatCompletion(history, (visibleText) => {
          streamed = visibleText;
          if (visibleText && !firstTextAt) {
            firstTextAt = Date.now();
            footer.content = `  Streaming local model response... first text in ${Math.max(1, Math.round((firstTextAt - startedAt) / 1000))}s`;
          }
          updateLine(assistantLine, "Gemma:", visibleText || "working...");
          footer.fg = THEME.yellow;
        });
        const toolCalls = message.tool_calls ?? [];
        if (!toolCalls.length) {
          reply = streamed || visibleAssistantText(message.content ?? "") || "(empty response)";
          updateLine(assistantLine, "Gemma:", reply);
          wroteReply = true;
          break;
        }

        updateLine(assistantLine, "Gemma:", "checking Twilio tools...");
        history.push({
          role: "assistant",
          content: visibleAssistantText(message.content ?? ""),
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
      if (!wroteReply) addLine("Gemma:", reply, THEME.silver);
      history.push({ role: "assistant", content: reply });
      footer.content = "  Enter send    PageUp/PageDown scroll    Escape dashboard";
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
        footer.content = "  Voice input is not available yet.";
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
        footer.content = "  Enter send    PageUp/PageDown scroll    Escape dashboard";
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
      return;
    }
    if (isTranscriptScrollKey(key, input.value.length === 0) && transcript.handleKeyPress(key)) {
      key.preventDefault();
      key.stopPropagation();
    }
  };

  addLine("System:", "Local chat stays inside OpenTUI. The server starts in the background if needed.", THEME.dim2);
  void ensureServer();
  input.focus();
  return screen;
}
