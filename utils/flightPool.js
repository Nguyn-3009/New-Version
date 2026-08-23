// A fixed pool of pre-mounted flight slots.
//
// WHY THIS EXISTS
//
// RN Skia rebuilds its entire render pipeline on every React commit that
// touches the <Canvas> subtree. sksg/HostConfig.js has:
//
//   resetAfterCommit(container) { container.redraw(); }
//
// and sksg/Container.native.js's redraw() does, every single time:
//
//   Rea.stopMapper(this.mapperId)          // kill the mapper driving live
//                                          // animations
//   visit(new ReanimatedRecorder(), root)  // re-walk the ENTIRE scene graph
//   Rea.startMapper(...)                   // start a fresh one
//
// The old design mounted one <FlightLine> per airborne arrow and unmounted it
// on landing, so every launch AND every landing committed React state and paid
// that teardown - four commits per arrow once the tile re-record is counted.
//
// With one arrow that lands at the two moments you are least likely to notice.
// With four in the air the launches and landings interleave continuously, so
// the mapper is stopped and restarted right through the animation. That is the
// stutter, and it is why it scales with CONCURRENT arrows rather than with
// board size.
//
// Here the tree shape is FIXED. POOL_SIZE slots mount once and never unmount.
// A slot is claimed and released purely by writing shared values on the UI
// thread, so launching an arrow costs zero React commits.

import {
  Easing,
  makeMutable,
  runOnJS,
  withTiming,
} from "react-native-reanimated";

import { FORWARD_MS, MAX_PROGRESS } from "./gridConfig";

// How many arrows may be airborne at once. Idle slots cost essentially
// nothing: their shared values never change, so their derived values never
// recompute, and they contribute an empty path to the frame.
//
// Taps past this are dropped rather than queued. A player cannot usefully
// track twelve simultaneous arrows anyway, and dropping is strictly better
// than growing the tree.
export const POOL_SIZE = 12;

function makeSlotValues(init) {
  const out = [];
  for (let i = 0; i < POOL_SIZE; i++) out.push(makeMutable(init));
  return out;
}

// Which compiled line index this slot is flying, or -1 when free. This is the
// single source of truth for "is this slot busy".
export const SLOT_LINE = makeSlotValues(-1);
export const SLOT_PROGRESS = makeSlotValues(0);
export const SLOT_SETTLED = makeSlotValues(false);
export const SLOT_PREVLEN = makeSlotValues(0);

// Compiled geometry in a form the UI thread can read, so a tap can start a
// flight without a round trip through JS. Assigned ONCE per puzzle load, from
// loadPuzzle, alongside the other three shared values - see the note in
// gameShared.js about why the number of top-level assignments matters.
export const FLIGHT_GEOM = makeMutable(null);

export function buildFlightGeom(compiled) {
  if (!compiled) return null;
  return {
    ids: compiled.ids,
    indexById: compiled.indexById,
    pts: compiled.pts,
    cum: compiled.cum,
    total: compiled.total,
    ang: compiled.ang,
    // Colour flattened per line, so a slot never has to chase colorIdx into
    // colors on the UI thread. Strings are fine: RN Skia's processColor is
    // itself a worklet and resolves them at draw time.
    lineColor: compiled.colorIdx.map((k) => compiled.colors[k]),
  };
}

/** Free every slot. Runs on a puzzle load or a restart. */
export function resetPool() {
  "worklet";
  for (let i = 0; i < POOL_SIZE; i++) {
    SLOT_LINE[i].value = -1;
    SLOT_PROGRESS[i].value = 0;
    SLOT_SETTLED[i].value = false;
    SLOT_PREVLEN[i].value = 0;
  }
}

/** Which slot is flying `lineIdx`, or -1. */
export function slotFor(lineIdx) {
  "worklet";
  for (let i = 0; i < POOL_SIZE; i++) {
    if (SLOT_LINE[i].value === lineIdx) return i;
  }
  return -1;
}

/**
 * Claim a slot and start `lineIdx` flying. Returns the slot, or -1 if the
 * launch was refused (unknown line, already airborne, pool full).
 *
 * Runs entirely on the UI thread. `notifyDone` is the JS-side game-logic
 * callback and is reached through runOnJS exactly once per flight.
 */
export function launchFlight(lineIdx, notifyDone) {
  "worklet";
  const g = FLIGHT_GEOM.value;
  if (!g || lineIdx === undefined || lineIdx < 0) return -1;

  // Already airborne. The old startFlight deduped on the flights array; the
  // case is real because a mid-bounce arrow still has its cells in the trigger
  // grid and so is still tappable.
  if (slotFor(lineIdx) >= 0) return -1;

  let slot = -1;
  for (let i = 0; i < POOL_SIZE; i++) {
    if (SLOT_LINE[i].value < 0) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return -1;

  const id = g.ids[lineIdx];
  const total = g.total[lineIdx];

  const line = SLOT_LINE[slot];
  const progress = SLOT_PROGRESS[slot];
  const settled = SLOT_SETTLED[slot];

  settled.value = false;
  SLOT_PREVLEN[slot].value = total;
  progress.value = 0;
  line.value = lineIdx;

  progress.value = withTiming(
    MAX_PROGRESS,
    { duration: FORWARD_MS, easing: Easing.linear },
    (finished) => {
      "worklet";
      // The slot was recycled or reset (new puzzle, restart) while this
      // animation was live - resetPool cancels it, which fires this callback
      // with finished=false. Drop it rather than reporting a landing for a
      // board that no longer exists.
      if (line.value !== lineIdx) return;

      if (finished && !settled.value) {
        settled.value = true;
        line.value = -1;
        runOnJS(notifyDone)(id, true);
      }
    },
  );

  return slot;
}