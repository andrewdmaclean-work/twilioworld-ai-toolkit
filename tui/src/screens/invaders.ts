import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { THEME } from "../theme.ts";
import { buildEmbeddedRouteChrome } from "./chrome.ts";

interface Enemy {
  x: number;
  y: number;
  alive: boolean;
}

interface Bullet {
  x: number;
  y: number;
}

const W = 32;
const H = 15;
const TICK_MS = 120;

export function buildInvadersScreen(renderer: CliRenderer, onCancel: () => void): BoxRenderable {
  const { screen, body, footer } = buildEmbeddedRouteChrome(renderer, {
    id: "invaders-screen",
    route: "Dashboard / ???",
    title: "Signal Invaders",
    subtitle: "Defend the terminal uplink.",
    bodyTitle: "Arcade",
    footer: "  Left/Right move    Space fire    R restart    Escape dashboard",
  });
  screen.focusable = true;

  const scoreText = new TextRenderable(renderer, {
    id: "invaders-score",
    content: "",
    fg: THEME.cyan,
  });
  const boardText = new TextRenderable(renderer, {
    id: "invaders-board",
    content: "",
    fg: THEME.silver,
  });

  body.add(scoreText);
  body.add(boardText);

  let player = Math.floor(W / 2);
  let bullets: Bullet[] = [];
  let enemies: Enemy[] = [];
  let dir = 1;
  let tick = 0;
  let score = 0;
  let over = false;
  let message = "";

  function reset(): void {
    player = Math.floor(W / 2);
    bullets = [];
    enemies = [];
    dir = 1;
    tick = 0;
    score = 0;
    over = false;
    message = "";
    for (let y = 1; y <= 4; y++) {
      for (let x = 4; x <= W - 5; x += 4) {
        enemies.push({ x, y, alive: true });
      }
    }
    render();
  }

  function render(): void {
    const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => " "));
    for (let x = 0; x < W; x++) {
      grid[0][x] = "-";
      grid[H - 1][x] = "-";
    }
    for (let y = 0; y < H; y++) {
      grid[y][0] = "|";
      grid[y][W - 1] = "|";
    }

    for (const enemy of enemies) {
      if (enemy.alive && enemy.y > 0 && enemy.y < H - 1) grid[enemy.y][enemy.x] = "A";
    }
    for (const bullet of bullets) {
      if (bullet.y > 0 && bullet.y < H - 1) grid[bullet.y][bullet.x] = "|";
    }
    grid[H - 2][player] = "^";

    scoreText.content = `Score ${score.toString().padStart(3, "0")}   ${message}`;
    boardText.content = grid.map((row) => row.join("")).join("\n");
  }

  function step(): void {
    if (over) return;
    tick++;

    bullets = bullets
      .map((bullet) => ({ ...bullet, y: bullet.y - 1 }))
      .filter((bullet) => bullet.y > 0);

    for (const bullet of bullets) {
      const hit = enemies.find((enemy) => enemy.alive && enemy.x === bullet.x && enemy.y === bullet.y);
      if (!hit) continue;
      hit.alive = false;
      bullet.y = -1;
      score += 10;
    }
    bullets = bullets.filter((bullet) => bullet.y > 0);

    if (tick % 5 === 0) {
      const live = enemies.filter((enemy) => enemy.alive);
      const edge = live.some((enemy) => enemy.x + dir >= W - 2 || enemy.x + dir <= 1);
      if (edge) {
        dir *= -1;
        for (const enemy of live) enemy.y++;
      } else {
        for (const enemy of live) enemy.x += dir;
      }
    }

    const live = enemies.filter((enemy) => enemy.alive);
    if (!live.length) {
      over = true;
      message = "Signal clear. R to replay.";
    } else if (live.some((enemy) => enemy.y >= H - 2)) {
      over = true;
      message = "Uplink lost. R to retry.";
    }

    render();
  }

  function cleanup(): void {
    clearInterval(loop);
  }

  screen.onKeyDown = (key: KeyEvent) => {
    if (key.name === "escape" || key.name === "q") {
      key.preventDefault();
      key.stopPropagation();
      cleanup();
      onCancel();
      return;
    }
    if (key.name === "r") {
      key.preventDefault();
      key.stopPropagation();
      reset();
      return;
    }
    if (over) return;
    if (key.name === "left" || key.name === "h" || key.name === "a") {
      player = Math.max(1, player - 1);
      render();
      key.preventDefault();
      key.stopPropagation();
    } else if (key.name === "right" || key.name === "l" || key.name === "d") {
      player = Math.min(W - 2, player + 1);
      render();
      key.preventDefault();
      key.stopPropagation();
    } else if (key.name === "space") {
      if (bullets.length < 3) bullets.push({ x: player, y: H - 3 });
      render();
      key.preventDefault();
      key.stopPropagation();
    }
  };

  const loop = setInterval(step, TICK_MS);
  reset();
  screen.focus();

  return screen;
}
