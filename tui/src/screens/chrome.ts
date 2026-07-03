import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { THEME } from "../theme.ts";

interface RouteChromeOptions {
  id: string;
  route: string;
  title: string;
  subtitle: string;
  bodyTitle: string;
  footer?: string;
}

export interface RouteChrome {
  screen: BoxRenderable;
  body: BoxRenderable;
  footer: TextRenderable;
}

export function buildRouteChrome(renderer: CliRenderer, opts: RouteChromeOptions): RouteChrome {
  const screen = new BoxRenderable(renderer, {
    id: opts.id,
    width: "100%",
    height: "100%",
    flexGrow: 1,
    flexDirection: "column",
    padding: 0,
    gap: 1,
    backgroundColor: THEME.appBg,
  });

  const header = new BoxRenderable(renderer, {
    id: `${opts.id}-header`,
    borderStyle: "double",
    borderColor: THEME.red,
    title: " TwilioWorld Agentic Coding Toolkit ",
    titleColor: THEME.white,
    paddingX: 1,
    flexDirection: "column",
    backgroundColor: THEME.panelBg,
  });
  header.add(new TextRenderable(renderer, {
    id: `${opts.id}-route`,
    content: opts.route,
    fg: THEME.cyan,
  }));
  header.add(new TextRenderable(renderer, {
    id: `${opts.id}-title`,
    content: opts.title,
    fg: THEME.white,
  }));
  header.add(new TextRenderable(renderer, {
    id: `${opts.id}-subtitle`,
    content: opts.subtitle,
    fg: THEME.yellow,
  }));

  const body = new BoxRenderable(renderer, {
    id: `${opts.id}-body`,
    borderStyle: "single",
    borderColor: THEME.redDim,
    title: ` ${opts.bodyTitle} `,
    titleColor: THEME.red,
    flexDirection: "column",
    flexGrow: 1,
    gap: 1,
    padding: 1,
    backgroundColor: THEME.panelBg,
  });

  const footer = new TextRenderable(renderer, {
    id: `${opts.id}-footer`,
    content: opts.footer ?? "  Escape dashboard    Enter select",
    fg: THEME.dim,
  });

  screen.add(header);
  screen.add(body);
  screen.add(footer);
  return { screen, body, footer };
}

export function buildEmbeddedRouteChrome(renderer: CliRenderer, opts: RouteChromeOptions): RouteChrome {
  const screen = new BoxRenderable(renderer, {
    id: opts.id,
    width: "100%",
    height: "100%",
    flexGrow: 1,
    flexDirection: "column",
    gap: 1,
    backgroundColor: THEME.panelBg,
  });

  const header = new BoxRenderable(renderer, {
    id: `${opts.id}-header`,
    borderStyle: "single",
    borderColor: THEME.redDim,
    title: ` ${opts.route} `,
    titleColor: THEME.red,
    paddingX: 1,
    flexDirection: "column",
    backgroundColor: THEME.panelBg,
  });
  header.add(new TextRenderable(renderer, {
    id: `${opts.id}-title`,
    content: opts.title,
    fg: THEME.white,
  }));
  header.add(new TextRenderable(renderer, {
    id: `${opts.id}-subtitle`,
    content: opts.subtitle,
    fg: THEME.yellow,
  }));

  const body = new BoxRenderable(renderer, {
    id: `${opts.id}-body`,
    flexDirection: "column",
    flexGrow: 1,
    gap: 1,
    backgroundColor: THEME.panelBg,
  });

  const footer = new TextRenderable(renderer, {
    id: `${opts.id}-footer`,
    content: opts.footer ?? "  Escape dashboard    Enter select",
    fg: THEME.dim,
  });

  screen.add(header);
  screen.add(body);
  screen.add(footer);
  return { screen, body, footer };
}

export function removeAllChildren(box: BoxRenderable): void {
  for (const child of [...box.getChildren()]) {
    box.remove(child.id);
  }
}
