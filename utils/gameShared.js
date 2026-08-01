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

// Debug counter only; nothing reacts to it.
export const onTap = makeMutable(0);