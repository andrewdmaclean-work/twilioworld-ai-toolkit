# Local Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Phi-4-mini as a second local model option alongside Gemma 4 E2B, with a TUI picker to switch between them.

**Architecture:** A new `lib/local-models.ts` registry owns the model catalog and the "which model is active" logic. All files that currently import hardcoded Gemma constants are updated to call `getSelectedModel()` instead. A new `screens/model-picker.ts` submenu is wired into the existing model-controls screen.

**Tech Stack:** TypeScript, Bun, @opentui/core, llamafile (runtime unchanged)

## Global Constraints

- Never remove `MODELS_DIR`, `TOOLS_DIR`, `LLAMAFILE_DEST`, `LLAMAFILE_URL` from `constants.ts` — only the Gemma-specific model constants are removed
- All new screens must follow the `buildSubmenuScreen` pattern used by `screens/settings.ts` and `screens/model-controls.ts`
- Config writes use `writeConfig` / `setModelReasoningMode` pattern — read first, overlay one field, write back
- Run `cd tui && bun test src/screens/ui.test.ts` after every task — must stay green
- Phi-4-mini GGUF: `https://huggingface.co/microsoft/Phi-4-mini-instruct-gguf/resolve/main/Phi-4-mini-instruct-Q4_0.gguf`
- Phi-4-mini size: ~2.5 GB (`2_500_000_000` bytes, min floor `1_500_000_000`)

---

### Task 1: Create `lib/local-models.ts` with catalog and helpers

**Files:**
- Create: `tui/src/lib/local-models.ts`

**Interfaces:**
- Produces:
  - `interface LocalModel { slug, name, description, url, sizeBytes, sizeLabel, minBytes, dest, staging, mmproj? }`
  - `LOCAL_MODELS: LocalModel[]`
  - `DEFAULT_MODEL_SLUG: string`
  - `getModel(slug: string): LocalModel`
  - `getSelectedModel(): LocalModel`
  - `localModelInstalled(model: LocalModel): boolean`

- [ ] **Step 1: Write the file**

```typescript
// lib/local-models.ts — local model catalog and selection helpers.

import { existsSync, statSync } from "fs";
import { join } from "path";
import { MODELS_DIR } from "./constants.ts";
import { readConfig } from "./config.ts";
import { fileExecutable } from "./exec.ts";
import { LLAMAFILE_DEST } from "./constants.ts";

export interface LocalModel {
  slug: string;
  name: string;
  description: string;
  url: string;
  sizeBytes: number;
  sizeLabel: string;
  minBytes: number;
  dest: string;
  staging: string;
  mmproj?: string;
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    slug: "gemma4-e2b",
    name: "Gemma 4 E2B",
    description: "Google · multimodal · ~3.3 GB",
    url: "https://www.kaggle.com/api/v1/models/google/gemma-4/gguf/gemma-4-e2b-it-qat-q4_0-gguf/2/download",
    sizeBytes: 3_543_348_429,
    sizeLabel: "3.3 GB",
    minBytes: 1_500_000_000,
    dest: join(MODELS_DIR, "gemma4-e2b.gguf"),
    staging: join(MODELS_DIR, "gemma4-e2b.download"),
    mmproj: join(MODELS_DIR, "gemma4-e2b-mmproj.gguf"),
  },
  {
    slug: "phi4-mini",
    name: "Phi-4-mini",
    description: "Microsoft · reasoning + code · ~2.5 GB",
    url: "https://huggingface.co/microsoft/Phi-4-mini-instruct-gguf/resolve/main/Phi-4-mini-instruct-Q4_0.gguf",
    sizeBytes: 2_500_000_000,
    sizeLabel: "2.5 GB",
    minBytes: 1_500_000_000,
    dest: join(MODELS_DIR, "phi4-mini.gguf"),
    staging: join(MODELS_DIR, "phi4-mini.download"),
  },
];

export const DEFAULT_MODEL_SLUG = "gemma4-e2b";

export function getModel(slug: string): LocalModel {
  const m = LOCAL_MODELS.find((m) => m.slug === slug);
  if (!m) throw new Error(`Unknown model slug: ${slug}`);
  return m;
}

export function getSelectedModel(): LocalModel {
  const cfg = readConfig();
  const slug = cfg.settings.localModelSlug ?? DEFAULT_MODEL_SLUG;
  return LOCAL_MODELS.find((m) => m.slug === slug) ?? LOCAL_MODELS[0];
}

export function localModelInstalled(model: LocalModel): boolean {
  if (!fileExecutable(LLAMAFILE_DEST)) return false;
  if (!existsSync(model.dest)) return false;
  try { return statSync(model.dest).size >= model.minBytes; } catch { return false; }
}
```

- [ ] **Step 2: Run tests**

```bash
cd tui && bun test src/screens/ui.test.ts
```
Expected: 8 pass, 0 fail

- [ ] **Step 3: Commit**

```bash
git add tui/src/lib/local-models.ts
git commit -m "feat: add local model catalog with Gemma 4 E2B and Phi-4-mini"
```

---

### Task 2: Add `localModelSlug` to config

**Files:**
- Modify: `tui/src/lib/config.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `setLocalModelSlug(slug: string): void` export; `settings.localModelSlug?: string` in `ToolkitConfig`

- [ ] **Step 1: Update `ToolkitConfig` interface** — add `localModelSlug` to settings:

In `tui/src/lib/config.ts`, change:
```typescript
export interface ToolkitConfig {
  version: number;
  addons: Record<AddonKey, boolean>;
  settings: {
    modelReasoning: ModelReasoningMode;
  };
}
```
to:
```typescript
export interface ToolkitConfig {
  version: number;
  addons: Record<AddonKey, boolean>;
  settings: {
    modelReasoning: ModelReasoningMode;
    localModelSlug?: string;
  };
}
```

- [ ] **Step 2: Persist and read `localModelSlug` in `readConfig`**

In `readConfig()`, after the `modelReasoning` lines in the base-defaults block, add:
```typescript
let localModelSlug: string | undefined;
```
Then in the defaults loop after `modelReasoning = validReasoningMode(...)`:
```typescript
if (typeof d?.settings?.localModelSlug === "string") localModelSlug = d.settings.localModelSlug;
```
In the local-config overlay after `modelReasoning = validReasoningMode(local?.settings?.modelReasoning, modelReasoning)`:
```typescript
if (typeof local?.settings?.localModelSlug === "string") localModelSlug = local.settings.localModelSlug;
```
Update both return statements to include `localModelSlug`:
```typescript
return { version: local.version ?? 1, addons: base, settings: { modelReasoning, localModelSlug } };
```
and:
```typescript
return { version: 1, addons: base, settings: { modelReasoning, localModelSlug } };
```

- [ ] **Step 3: Update `writeConfig` signature**

Change:
```typescript
export function writeConfig(
  addons: Record<AddonKey, boolean>,
  settings: ToolkitConfig["settings"] = readConfig().settings,
): void {
```
No change needed — `settings` is passed through as-is, so `localModelSlug` round-trips automatically.

- [ ] **Step 4: Add `setLocalModelSlug`** at the bottom of `config.ts`:

```typescript
export function setLocalModelSlug(slug: string): void {
  const config = readConfig();
  writeConfig(config.addons, { ...config.settings, localModelSlug: slug });
}
```

- [ ] **Step 5: Run tests**

```bash
cd tui && bun test src/screens/ui.test.ts
```
Expected: 8 pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add tui/src/lib/config.ts
git commit -m "feat: add localModelSlug setting to config"
```

---

### Task 3: Update `model-install.ts` to accept `LocalModel`

**Files:**
- Modify: `tui/src/lib/model-install.ts`

**Interfaces:**
- Consumes: `LocalModel` from `./local-models.ts`
- Produces: `installLocalModel(opts: { model: LocalModel, onLog, heading?, keepArchiveNotice? }): Promise<boolean>`; `localModelInstalled` re-export removed (now in `local-models.ts`)

- [ ] **Step 1: Replace hardcoded constant imports with `LocalModel`**

Remove from the import block:
```typescript
import {
  GGUF_DEST,
  GGUF_MIN_BYTES,
  GGUF_MMPROJ,
  GGUF_STAGING,
  GGUF_URL,
  LLAMAFILE_DEST,
  LLAMAFILE_SIZE_BYTES,
  LLAMAFILE_SIZE_LABEL,
  LOCAL_MODEL_SIZE_BYTES,
  LOCAL_MODEL_SIZE_LABEL,
  MODELS_DIR,
  ROOT,
  TOOLS_DIR,
} from "./constants.ts";
```

Replace with:
```typescript
import {
  LLAMAFILE_DEST,
  LLAMAFILE_SIZE_BYTES,
  LLAMAFILE_SIZE_LABEL,
  MODELS_DIR,
  ROOT,
  TOOLS_DIR,
} from "./constants.ts";
import type { LocalModel } from "./local-models.ts";
```

- [ ] **Step 2: Remove the old `localModelInstalled` export and update `ggufSizeOk`/`ggufStagingExists`**

Delete:
```typescript
function ggufSizeOk(): boolean {
  if (!existsSync(GGUF_DEST)) return false;
  try { return statSync(GGUF_DEST).size >= GGUF_MIN_BYTES; } catch { return false; }
}
```
and:
```typescript
function ggufStagingExists(): boolean {
  return existsSync(GGUF_STAGING);
}
```
and:
```typescript
export function localModelInstalled(): boolean {
  return runtimeOk() && ggufSizeOk();
}
```

Add model-parameterized versions inside `installLocalModel` (they're only used there anyway):
```typescript
function ggufSizeOk(model: LocalModel): boolean {
  if (!existsSync(model.dest)) return false;
  try { return statSync(model.dest).size >= model.minBytes; } catch { return false; }
}

function ggufStagingExists(model: LocalModel): boolean {
  return existsSync(model.staging);
}
```

- [ ] **Step 3: Update `installLocalModel` signature and body**

Change signature from:
```typescript
export async function installLocalModel(opts: {
  onLog: LogFn;
  heading?: string;
  keepArchiveNotice?: boolean;
}): Promise<boolean> {
  const { onLog, heading, keepArchiveNotice = false } = opts;
```
to:
```typescript
export async function installLocalModel(opts: {
  model: LocalModel;
  onLog: LogFn;
  heading?: string;
  keepArchiveNotice?: boolean;
}): Promise<boolean> {
  const { model, onLog, heading, keepArchiveNotice = false } = opts;
```

Then replace all occurrences inside the function body:
- `ggufSizeOk()` → `ggufSizeOk(model)`
- `ggufStagingExists()` → `ggufStagingExists(model)`
- `localModelInstalled()` → `runtimeOk() && ggufSizeOk(model)`
- `GGUF_DEST` → `model.dest`
- `GGUF_STAGING` → `model.staging`
- `GGUF_MMPROJ` → `model.mmproj` (guard with `model.mmproj &&` before each use)
- `GGUF_URL` → `model.url`
- `LOCAL_MODEL_SIZE_LABEL` → `model.sizeLabel`
- `LOCAL_MODEL_SIZE_BYTES` → `model.sizeBytes`

The early-return check at the top changes from:
```typescript
if (localModelInstalled()) {
  ok("llamafile runtime already present", onLog);
  ok("Model weights already present", onLog);
  if (existsSync(GGUF_MMPROJ)) ok("mmproj (multimodal) already present", onLog);
  return true;
}
```
to:
```typescript
if (runtimeOk() && ggufSizeOk(model)) {
  ok("llamafile runtime already present", onLog);
  ok("Model weights already present", onLog);
  if (model.mmproj && existsSync(model.mmproj)) ok("mmproj (multimodal) already present", onLog);
  return true;
}
```

The mmproj rename after extraction:
```typescript
if (mmproj) renameSync(mmproj, GGUF_MMPROJ);
```
becomes:
```typescript
if (mmproj && model.mmproj) renameSync(mmproj, model.mmproj);
```

The keepArchiveNotice line:
```typescript
if (keepArchiveNotice) ok(`Archive kept at ${GGUF_STAGING} — delete it to reclaim ~${LOCAL_MODEL_SIZE_LABEL}`, onLog);
```
becomes:
```typescript
if (keepArchiveNotice) ok(`Archive kept at ${model.staging} — delete it to reclaim ~${model.sizeLabel}`, onLog);
```

- [ ] **Step 4: Run tests**

```bash
cd tui && bun test src/screens/ui.test.ts
```
Expected: 8 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add tui/src/lib/model-install.ts
git commit -m "refactor: parameterize model-install with LocalModel instead of hardcoded paths"
```

---

### Task 4: Update callers — `status.ts`, `model.ts`, `actions.ts`, `uninstall.ts`

**Files:**
- Modify: `tui/src/status.ts`, `tui/src/lib/model.ts`, `tui/src/lib/actions.ts`, `tui/src/lib/uninstall.ts`

**Interfaces:**
- Consumes: `getSelectedModel`, `localModelInstalled`, `LOCAL_MODELS` from `./local-models.ts`

- [ ] **Step 1: Update `status.ts`**

Add import:
```typescript
import { getSelectedModel } from "./lib/local-models.ts";
```

Remove from constants import: `GGUF_DEST`, `GGUF_MIN_BYTES`

Replace `ggufReady()` function:
```typescript
function ggufReady(): boolean {
  const model = getSelectedModel();
  if (!existsSync(model.dest)) return false;
  try { return statSync(model.dest).size >= model.minBytes; } catch { return false; }
}
```

- [ ] **Step 2: Update `model.ts`**

Add import:
```typescript
import { getSelectedModel } from "./local-models.ts";
```

Remove from constants import: `GGUF_DEST`, `GGUF_MIN_BYTES`, `GGUF_MMPROJ`

Update `modelReady()`:
```typescript
export function modelReady(): { runtime: boolean; weights: boolean } {
  const runtime = fileExecutable(LLAMAFILE_DEST);
  const model = getSelectedModel();
  let weights = false;
  if (existsSync(model.dest)) {
    try { weights = statSync(model.dest).size >= model.minBytes; } catch { /* ignore */ }
  }
  return { runtime, weights };
}
```

Update `baseModelArgs()`:
```typescript
function baseModelArgs(): string[] {
  const model = getSelectedModel();
  const args = [
    "-m", model.dest,
    "--ctx-size", MODEL_CTX_SIZE,
    "--parallel", "1",
    "--flash-attn", "on",
    "--cache-type-k", "q4_0",
    "--cache-type-v", "q4_0",
    "--reasoning", MODEL_REASONING,
  ];
  if (model.mmproj && existsSync(model.mmproj)) args.push("--mmproj", model.mmproj);
  return args;
}
```

- [ ] **Step 3: Update `actions.ts`**

Add import:
```typescript
import { getSelectedModel } from "./local-models.ts";
```

Update `downloadLocalModel`:
```typescript
export async function downloadLocalModel(opts: { onLog: LogFn; onDone: (ok: boolean) => void }): Promise<void> {
  const { onLog, onDone } = opts;
  const model = getSelectedModel();
  const result = await installLocalModel({ model, onLog, heading: `Local AI model — ${model.name} via llamafile` });
  onDone(result);
}
```

- [ ] **Step 4: Update `uninstall.ts` `removeModelRuntime`**

Add import:
```typescript
import { getSelectedModel } from "./local-models.ts";
```

Remove from constants import: `GGUF_DEST`, `GGUF_MMPROJ`, `GGUF_STAGING`

Update `removeModelRuntime`:
```typescript
function removeModelRuntime(onLog: LogFn): boolean {
  step("Local model and runtimes", onLog);
  const model = getSelectedModel();
  const paths = [
    model.dest,
    model.staging,
    ...(model.mmproj ? [model.mmproj] : []),
    WHISPER_MODEL_DEST,
    WHISPER_MODEL_STAGING,
    MODEL_SERVER_LOG,
    LLAMAFILE_DEST,
    WHISPERFILE_DEST,
    join(TOOLS_DIR, "llamafile.exe"),
    join(TOOLS_DIR, "whisperfile.exe"),
    join(MODELS_DIR, "voice"),
    join(MODELS_DIR, "extract_tmp"),
  ];
  const removed = paths.map(rmPath).filter(Boolean).length + removeExtractDirs();
  if (removed) ok(`Removed ${removed} local model/runtime path(s).`, onLog);
  else ok("No downloaded model/runtime files found.", onLog);
  return true;
}
```

- [ ] **Step 5: Remove Gemma-specific constants from `constants.ts`**

Delete these lines from `tui/src/lib/constants.ts`:
```typescript
export const GGUF_URL = ...
export const GGUF_DEST = ...
export const GGUF_MMPROJ = ...
export const GGUF_STAGING = ...
export const GGUF_MIN_BYTES = ...
export const LOCAL_MODEL_SIZE_LABEL = ...
export const LOCAL_MODEL_SIZE_BYTES = ...
```

- [ ] **Step 6: Fix any remaining imports of removed constants**

```bash
cd tui && grep -rn "GGUF_DEST\|GGUF_MMPROJ\|GGUF_STAGING\|GGUF_MIN_BYTES\|GGUF_URL\|LOCAL_MODEL_SIZE" src/ --include="*.ts"
```

For each hit — remove the import and replace usage with `getSelectedModel().<field>`.

Also check `index.ts` for `LOCAL_MODEL_SIZE_LABEL` — it's used in `nextMove()` and `detailFor()`. Replace those with `getSelectedModel().sizeLabel`.

- [ ] **Step 7: Run tests**

```bash
cd tui && bun test src/screens/ui.test.ts
```
Expected: 8 pass, 0 fail

- [ ] **Step 8: Commit**

```bash
git add tui/src/status.ts tui/src/lib/model.ts tui/src/lib/actions.ts tui/src/lib/uninstall.ts tui/src/lib/constants.ts tui/src/index.ts
git commit -m "refactor: replace hardcoded Gemma constants with getSelectedModel() across callers"
```

---

### Task 5: Build `screens/model-picker.ts` and wire into `model-controls.ts`

**Files:**
- Create: `tui/src/screens/model-picker.ts`
- Modify: `tui/src/screens/model-controls.ts`
- Modify: `tui/src/index.ts`

**Interfaces:**
- Consumes: `LOCAL_MODELS`, `getSelectedModel` from `../lib/local-models.ts`; `buildSubmenuScreen` from `./submenu.ts`
- Produces: `buildModelPickerScreen(renderer, opts): BoxRenderable`

- [ ] **Step 1: Create `model-picker.ts`**

```typescript
import { type BoxRenderable, type CliRenderer } from "@opentui/core";
import { buildSubmenuScreen } from "./submenu.ts";
import { LOCAL_MODELS, getSelectedModel } from "../lib/local-models.ts";
import { setLocalModelSlug } from "../lib/config.ts";
import { localModelInstalled } from "../lib/local-models.ts";

export function buildModelPickerScreen(
  renderer: CliRenderer,
  opts: {
    onModelReady: () => void;
    onModelNeedsDownload: () => void;
    onCancel: () => void;
  },
): BoxRenderable {
  const current = getSelectedModel();
  return buildSubmenuScreen(renderer, {
    id: "model-picker-screen",
    route: "Dashboard / Settings / Local AI model / Change model",
    title: "Change model",
    subtitle: "Choose which local model to use. Already-downloaded models switch instantly.",
    bodyTitle: "Available models",
    options: LOCAL_MODELS.map((m) => ({
      name: m.slug === current.slug ? `● ${m.name}` : `  ${m.name}`,
      description: m.description,
      onSelect: () => {
        setLocalModelSlug(m.slug);
        if (localModelInstalled(m)) {
          opts.onModelReady();
        } else {
          opts.onModelNeedsDownload();
        }
        return false;
      },
    })),
  }, opts.onCancel);
}
```

- [ ] **Step 2: Update `model-controls.ts`** — add "Change model" option

In `buildModelControlsScreen`, add `onChangeModel: () => void` to the `opts` type, then insert the option between "Response style" and "Stop local AI":

```typescript
{
  name: `Change model: ${opts.selectedModelName}`,
  description: "switch between Gemma 4 E2B and Phi-4-mini",
  onSelect: () => { opts.onChangeModel(); return false; },
},
```

Also add `selectedModelName: string` to opts:
```typescript
opts: {
  status: ToolkitStatus | null;
  reasoningMode: ModelReasoningMode;
  selectedModelName: string;
  onOpenBrowser: () => void;
  onToggleReasoning: () => void;
  onChangeModel: () => void;
  onStop: () => void;
  onRemove: () => void;
  onMissingModel: () => void;
  onCancel: () => void;
}
```

- [ ] **Step 3: Wire picker into `index.ts`**

Add import:
```typescript
import { buildModelPickerScreen } from "./screens/model-picker.ts";
import { getSelectedModel } from "./lib/local-models.ts";
import { setLocalModelSlug } from "./lib/config.ts";
```

In `showModelControls()`, add `selectedModelName: getSelectedModel().name` to the opts object, and add `onChangeModel`:

```typescript
onChangeModel: () => {
  showRoute(buildModelPickerScreen(renderer, {
    onModelReady: () => {
      flash(`Switched to ${getSelectedModel().name}`, GREEN);
      refreshStatus();
      back();
    },
    onModelNeedsDownload: () => {
      runAction(`Download ${getSelectedModel().name}`, (onLog, onDone) => downloadLocalModel({ onLog, onDone }));
    },
    onCancel: () => showModelControls(),
  }), "Change model");
},
```

- [ ] **Step 4: Run tests**

```bash
cd tui && bun test src/screens/ui.test.ts
```
Expected: 8 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add tui/src/screens/model-picker.ts tui/src/screens/model-controls.ts tui/src/index.ts
git commit -m "feat: add model picker UI — switch between Gemma 4 E2B and Phi-4-mini"
```

---

### Task 6: Smoke-test the full flow

- [ ] **Step 1: Build the TUI**

```bash
cd tui && bun build src/index.ts --outdir dist --target node 2>&1
```
Expected: no errors

- [ ] **Step 2: Run all tests**

```bash
cd tui && bun test src/screens/ui.test.ts
```
Expected: 8 pass, 0 fail

- [ ] **Step 3: Type-check**

```bash
cd tui && bunx tsc --noEmit 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 4: Smoke the TUI**

```bash
cd /Users/amaclean/Documents/GitHub/twilioworld-ai-toolkit && TOOLKIT_TUI_SMOKE=1 node tui/dist/index.js 2>&1
```
Expected: prints status lines without crashing

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: local model picker — Gemma 4 E2B + Phi-4-mini with non-destructive switching"
```
