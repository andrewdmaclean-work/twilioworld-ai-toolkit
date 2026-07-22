# Local Model Picker — Design Spec
_2026-07-22_

## Goal

Add Phi-4-mini as a second local model option alongside Gemma 4 E2B. Users choose their preferred model from the TUI; both models can coexist on disk; switching is non-destructive.

---

## Data model

New file: `tui/src/lib/local-models.ts`

```ts
interface LocalModel {
  slug: string;         // "gemma4-e2b" | "phi4-mini"
  name: string;         // "Gemma 4 E2B"
  description: string;  // "Google · multimodal · ~3.3 GB"
  url: string;          // GGUF download URL
  sizeBytes: number;
  sizeLabel: string;    // "3.3 GB"
  minBytes: number;     // validity floor for installed-check
  dest: string;         // absolute path: models/<slug>.gguf
  staging: string;      // models/<slug>.download
  mmproj?: string;      // models/<slug>-mmproj.gguf (optional)
}
```

Exports:
- `LOCAL_MODELS: LocalModel[]` — catalog of both models
- `DEFAULT_MODEL_SLUG = "gemma4-e2b"`
- `getModel(slug: string): LocalModel` — throws if unknown slug
- `getSelectedModel(): LocalModel` — reads config, falls back to default
- `localModelInstalled(model: LocalModel): boolean` — runtime + file check

**Phi-4-mini** is sourced from Hugging Face (microsoft/Phi-4-mini-instruct GGUF, Q4_0 or equivalent small quant). No mmproj needed.

`config.ts` adds `localModelSlug?: string` to the `settings` block. Absent = default (Gemma). New export: `setLocalModelSlug(slug: string): void` — same pattern as `setModelReasoningMode`.

---

## UI flow

`screens/model-controls.ts` gains a **"Change model"** option:
- Description shows the currently active model name: `"currently: Gemma 4 E2B"`
- Positioned between "Response style" and "Stop local AI"

New screen: `screens/model-picker.ts`
- Standard submenu listing both models (name + description line with size/vendor/capabilities)
- Selecting a model:
  1. Writes `localModelSlug` to config
  2. If model already downloaded → returns to model-controls (no extra step)
  3. If not yet downloaded → navigates to streaming install log (same flow as existing download)

**"Remove downloaded model"** removes only the currently selected model's files (`dest`, `staging`, `mmproj` if present). The other model's files are untouched.

---

## Install and runtime wiring

`model-install.ts` — `installLocalModel` accepts a `LocalModel` param:

```ts
export async function installLocalModel(opts: {
  model: LocalModel;
  onLog: LogFn;
  heading?: string;
  keepArchiveNotice?: boolean;
}): Promise<boolean>
```

All internal path/size references use `opts.model.*`. The old hardcoded Gemma constants (`GGUF_DEST`, `GGUF_STAGING`, `GGUF_MMPROJ`, `GGUF_MIN_BYTES`, `GGUF_URL`, `LOCAL_MODEL_SIZE_LABEL`, `LOCAL_MODEL_SIZE_BYTES`) are removed from `constants.ts`.

`status.ts` — `ggufReady()` calls `getSelectedModel()` to get `dest` and `minBytes`. No structural change.

`actions.ts` — `downloadLocalModel()` calls `getSelectedModel()` and passes it to `installLocalModel`.

`constants.ts` retains: `MODELS_DIR`, `TOOLS_DIR`, `LLAMAFILE_DEST`, `LLAMAFILE_URL`, and all non-model-specific paths.

---

## Files changed

| File | Change |
|---|---|
| `tui/src/lib/local-models.ts` | new — catalog, type, helpers |
| `tui/src/lib/config.ts` | add `localModelSlug` to settings |
| `tui/src/lib/constants.ts` | remove Gemma-specific model constants |
| `tui/src/lib/model-install.ts` | accept `LocalModel` param |
| `tui/src/status.ts` | use `getSelectedModel()` for file checks |
| `tui/src/lib/actions.ts` | pass selected model to `installLocalModel` |
| `tui/src/screens/model-controls.ts` | add "Change model" option |
| `tui/src/screens/model-picker.ts` | new — picker submenu |

---

## Out of scope

- MLX / Apple Silicon native runtime path
- Amazon / proprietary cloud models
- Auto-deleting the previously selected model on switch
- `toolkit ask "question"` CLI feature (follow-on)
