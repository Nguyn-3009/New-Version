// Cross-thread state, deliberately kept TINY.
//
// The previous version put the whole compiled puzzle (COMPILED, progress[],
// lineState[], activeList[]) into shared values. That was the crash: every
// shared value a useDerivedValue closes over becomes a mapper input —
// Reanimated builds mapper inputs from Object.values(worklet.__closure), not
// from the dependency array you pass — so six top-level assignments in
// loadPuzzle re-fired every whole-puzzle path rebuild six times over.
//
// Nothing here is read by a rebuild-the-world worklet any more. Only these
// two survive on the UI thread, because the tap gesture genuinely needs them
// synchronously to answer "did I hit a line, and can it escape?".

import { makeMutable } from "react-native-reanimated";

// GRID_ROWS x GRID_COLS, cell -> line id string or null.
// Nested mutation (clearId) is intentional and stays on the UI thread.
export const LINE_TRIGGERS = makeMutable(null);

// line id -> expanded dot list, for isThrough/clearId.
export const LINE_DOTS_MAP = makeMutable(null);

// line id -> {dr, dc}. Escape direction is now carried explicitly by
// generateLines rather than derived from the last two points, because a
// 1-cell arrow has no "last two points" to derive it from.
export const LINE_DIRS = makeMutable(null);

// Debug counter only; nothing reacts to it.
export const onTap = makeMutable(0);
/**
 * Remove a line's cells from the trigger grid.
 *
 * MUST run on the UI thread. LINE_TRIGGERS is a shared value and this mutates
 * it NESTED (grid[row][col] = null) - which only affects whichever thread's
 * copy you are on. Calling it from JS would silently leave the UI thread's
 * grid unchanged.
 *
 * Lives here rather than in the play screen so FlightLine can call it at the
 * moment an arrow actually escapes, without importing the screen that imports
 * FlightLine.
 */
export function restoreLineCells(lineId) {
  "worklet";
  const dots = LINE_DOTS_MAP.value?.[lineId];
  const grid = LINE_TRIGGERS.value;
  if (!dots || !grid) return;
  for (let i = 0; i < dots.length; i++) {
    const { row, col } = dots[i];
    if (grid[row] !== undefined) grid[row][col] = lineId;
  }
}

export function clearLineCells(lineId) {
  "worklet";
  const dots = LINE_DOTS_MAP.value?.[lineId];
  const grid = LINE_TRIGGERS.value;
  if (!dots || !grid) return;
  for (let i = 0; i < dots.length; i++) {
    const { row, col } = dots[i];
    if (grid[row] !== undefined) grid[row][col] = null;
  }
}