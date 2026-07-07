// screens/creds-prompt.ts — two-field prompt for Account SID + Auth Token.
//
// Used by Execute MCP setup: creating a restricted API key over the REST API
// requires the Account SID + Auth Token (a Standard API key — what the CLI
// stores after `twilio login` — cannot create keys). The token is used once
// to create the restricted key and is never persisted; only the resulting
// restricted key is saved.

import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { THEME } from "../theme.ts";
import { buildEmbeddedRouteChrome } from "./chrome.ts";

export function buildCredsPromptScreen(
  renderer: CliRenderer,
  opts: {
    onSubmit: (accountSid: string, authToken: string) => void;
    onCancel: () => void;
    prefillSid?: string;
  },
): BoxRenderable {
  const { screen, body } = buildEmbeddedRouteChrome(renderer, {
    id: "creds-screen",
    route: "Dashboard / Twilio CLI / Execute MCP",
    title: "Enter Twilio credentials",
    subtitle: "Account SID + Auth Token. Used once to create a read-only key; the token is not saved. Tab switches fields, Enter submits, Escape cancels.",
    bodyTitle: "Credentials",
  });

  const note = new TextRenderable(renderer, {
    id: "creds-note",
    content: "Find these at console.twilio.com. The Auth Token is shown as you type (it is never stored).",
    fg: THEME.yellow,
  });
  body.add(note);

  const sidLabel = new TextRenderable(renderer, { id: "creds-sid-label", content: "Account SID (ACxxxx…):", fg: THEME.silver });
  body.add(sidLabel);
  const sidInput = new InputRenderable(renderer, {
    id: "creds-sid",
    value: opts.prefillSid ?? "",
    placeholder: "AC…",
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    textColor: THEME.silver,
    focusedTextColor: THEME.white,
    placeholderColor: THEME.dim2,
  });
  body.add(sidInput);

  const tokenLabel = new TextRenderable(renderer, { id: "creds-token-label", content: "Auth Token:", fg: THEME.silver });
  body.add(tokenLabel);
  const tokenInput = new InputRenderable(renderer, {
    id: "creds-token",
    value: "",
    placeholder: "your auth token",
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    textColor: THEME.silver,
    focusedTextColor: THEME.white,
    placeholderColor: THEME.dim2,
  });
  body.add(tokenInput);

  const status = new TextRenderable(renderer, { id: "creds-status", content: "", fg: THEME.red });
  body.add(status);

  let focused: "sid" | "token" = opts.prefillSid ? "token" : "sid";
  function applyFocus() {
    if (focused === "sid") sidInput.focus();
    else tokenInput.focus();
  }

  function trySubmit() {
    const sid = sidInput.value.trim();
    const token = tokenInput.value.trim();
    if (!/^AC[a-fA-F0-9]{32}$/.test(sid)) {
      status.content = "Account SID must look like ACxxxxxxxx… (34 chars).";
      focused = "sid"; applyFocus();
      return;
    }
    if (token.length < 8) {
      status.content = "Enter your Auth Token.";
      focused = "token"; applyFocus();
      return;
    }
    opts.onSubmit(sid, token);
  }

  const onKey = (input: InputRenderable) => (key: { name?: string }) => {
    if (key.name === "escape") { opts.onCancel(); return; }
    if (key.name === "tab") {
      focused = focused === "sid" ? "token" : "sid";
      applyFocus();
    }
  };
  sidInput.onKeyDown = onKey(sidInput);
  tokenInput.onKeyDown = onKey(tokenInput);

  // Enter on the SID field advances to token; Enter on token submits.
  sidInput.on(InputRenderableEvents.ENTER, () => { focused = "token"; applyFocus(); });
  tokenInput.on(InputRenderableEvents.ENTER, () => { trySubmit(); });

  applyFocus();
  return screen;
}
