// checklist.ts — multi-select list built on SelectRenderable.
//
// SelectRenderable handles ↑/↓ navigation and renders the list.
// This wrapper intercepts Space to toggle the highlighted item and
// Enter (ITEM_SELECTED) to confirm the whole selection.
//
// Key bindings:
//   ↑ / k   navigate up
//   ↓ / j   navigate down
//   Space   toggle current item
//   Enter   confirm (calls onConfirm with checked keys)
//   Escape  cancel  (calls onCancel)

import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { THEME } from "./theme.ts";

export interface CheckItem {
  key: string;
  label: string;
  description: string;
}

const CHECK = "[x]";
const UNCHECK = "[ ]";

export class CheckList {
  readonly container: BoxRenderable;
  private _select: SelectRenderable;
  private _hint: TextRenderable;
  private _checked: Set<number>;
  readonly items: CheckItem[];

  onConfirm?: (checkedKeys: string[]) => void;
  onCancel?: () => void;

  constructor(
    renderer: CliRenderer,
    id: string,
    items: CheckItem[],
    initialChecked: Set<number>,
    opts: { width?: number; height?: number } = {},
  ) {
    this.items = items;
    this._checked = new Set(initialChecked);

    // No opts.width → stretch to fill the parent's width (Yoga default
    // alignItems: stretch resolves an "auto" cross-axis size to fill).
    // No opts.height → fill available vertical space (flexGrow) instead
    // of shrink-wrapping to item count, so the list doesn't leave a big
    // empty gap below it when there's room to show more. Explicit
    // opts.width/opts.height (if ever passed) still win.
    const height = opts.height ?? Math.min(items.length + 1, 14);

    this._select = new SelectRenderable(renderer, {
      id: `${id}-select`,
      width: opts.width,
      height,
      flexGrow: opts.height ? 0 : 1,
      flexShrink: 0,
      options: this._buildOptions(),
      backgroundColor: "transparent",
      focusedBackgroundColor: "transparent",
      textColor: THEME.silver,
      focusedTextColor: THEME.silver,
      selectedBackgroundColor: THEME.bgSelected,
      selectedTextColor: THEME.white,
      descriptionColor: THEME.dim2,
      selectedDescriptionColor: THEME.silver,
    });

    // Space toggles the current item.
    // onKeyDown fires before SelectRenderable's own key processing
    // so we can intercept Space without it propagating.
    this._select.onKeyDown = (key: KeyEvent) => {
      if (key.name === "space") {
        const i = this._select.getSelectedIndex();
        if (this._checked.has(i)) {
          this._checked.delete(i);
        } else {
          this._checked.add(i);
        }
        this._refresh();
        key.preventDefault();
        key.stopPropagation();
      } else if (key.name === "escape") {
        this.onCancel?.();
      }
    };

    // Enter confirms the whole selection.
    this._select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      this.onConfirm?.(this.getCheckedKeys());
    });

    this._hint = new TextRenderable(renderer, {
      id: `${id}-hint`,
      content: "▸ Press SPACE to check/uncheck an item · ENTER to save · ESC to cancel",
      fg: THEME.yellow,
    });

    this.container = new BoxRenderable(renderer, {
      id,
      flexDirection: "column",
      flexGrow: 1,
      gap: 1,
    });
    this.container.add(this._select);
    this.container.add(this._hint);
  }

  focus() {
    this._select.focus();
  }

  getCheckedKeys(): string[] {
    return this.items.filter((_, i) => this._checked.has(i)).map((item) => item.key);
  }

  private _buildOptions() {
    return this.items.map((item, i) => ({
      name: `${this._checked.has(i) ? CHECK : UNCHECK}  ${item.label}`,
      description: item.description,
      value: item.key,
    }));
  }

  private _refresh() {
    const idx = this._select.getSelectedIndex();
    this._select.options = this._buildOptions();
    this._select.setSelectedIndex(idx);
  }
}
