import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { MouseEvent as ReactMouseEvent } from 'react';

const interactiveSelector =
  'a, button, input, select, textarea, [contenteditable="true"], [role="button"], [role="link"]';

export function startWindowDrag(event: ReactMouseEvent<HTMLElement>): void {
  if (event.button !== 0 || !isTauri()) return;
  if ((event.target as Element).closest(interactiveSelector)) return;
  void getCurrentWindow().startDragging();
}
