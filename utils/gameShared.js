// All cross-thread game state lives here rather than in app/play/index.jsx.
//
// This is what kills the require cycle you're seeing in the bundler:
//   SkiaLine.jsx -> app/play/index.jsx -> SkiaLine.jsx
// The renderer needs LINE_TRIGGERS, and the screen needs the renderer, so
// whichever one owned the shared values created the loop. Now neither owns
// them: both import from this leaf module.
//
// THREADING CONTRACT (this is the important part, and it's the same rule you
// already documented above buildTriggerGrid):
//
//   * A top-level assignment `sv.value = x` synchronises the JS-thread and
//     UI-thread copies.
//   * A nested mutation `sv.value[i] = x` does NOT. It only touches whichever
//     thread's local copy you happen to be on.
//
// So every array below is *created and assigned wholesale from JS* (during
// puzzle load / restart), and thereafter *mutated only from worklets on the UI
// thread*. The JS thread never reads them back. That makes the nested-mutation
// behaviour a feature rather than a trap: per-frame animation state stays on
// the UI thread with zero serialisation cost.

import { makeMutable } from "react-native-reanimated";

// --- Puzzle data (assigned wholesale from JS on load/restart) ---------------

// GRID_ROWS x GRID_COLS, cell -> line id string or null.
export const LINE_TRIGGERS = makeMutable(null);

// line id -> expanded dot list. Read by isThrough/clearId.
export const LINE_DOTS_MAP = makeMutable(null);

// Output of compileLines(): flattened geometry for every line, plus the
// id->index map and per-colour bucket lists. See utils/lineBatch.js.
export const COMPILED = makeMutable(null);

// --- Per-line animation state (UI-thread mutation only) ---------------------

export const LINE_IDLE = 0;
export const LINE_MOVING = 1;
export const LINE_RETURNING = 2;
export const LINE_ESCAPED = 3;

// progress[i] mirrors the old per-line `progress` shared value: 0 at rest,
// climbing to MAX_PROGRESS as the arrow flies out.
export const progress = makeMutable([]);

// lineState[i] is one of the LINE_* constants above. Replaces the old
// per-line `isMoving` boolean, with the extra states needed to distinguish
// "bouncing back" from "gone".
export const lineState = makeMutable([]);

// returnRate[i] is captured at the moment a bounce starts, so the return
// always takes RETURN_MS regardless of how far the arrow got — matching
// withTiming(0, {duration: 500}) from wherever progress happened to be.
export const returnRate = makeMutable([]);

// Indices currently animating. The frame loop walks ONLY this list, so a
// 875-line puzzle with one arrow in flight costs one iteration per frame
// instead of 875.
export const activeList = makeMutable([]);

// --- Render triggers --------------------------------------------------------

// Bumped whenever the set of at-rest lines changes (a line launches, lands,
// or escapes). Drives the resting layer's rebuild.
export const staticEpoch = makeMutable(0);

// Bumped once per frame while anything is animating. Drives the active
// layer's rebuild. Deliberately NOT bumped when nothing moves, so an idle
// board costs nothing.
export const frameTick = makeMutable(0);

// Kept for parity with the old API. Nothing reacts to onTap any more — taps
// now start their line directly — but it's still a handy debug counter.
export const onTap = makeMutable(0);