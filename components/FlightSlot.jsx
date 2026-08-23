// One pre-mounted flight slot.
//
// Mounted POOL_SIZE times at load and never unmounted. When its slot is free
// it contributes two empty paths to the frame and its derived values never
// recompute, because none of the shared values they close over change.
//
// This replaces FlightLine, which was mounted per airborne arrow. See the
// header of utils/flightPool.js for why that mattered.
//
// The collision test is unchanged: SWEPT, not point-sampled. At MAX_PROGRESS
// the head advances ~2.1 grid cells per frame, so checking only where the head
// *is* skips every other cell.

import { Path, Skia } from "@shopify/react-native-skia";
import {
  Easing,
  runOnJS,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";

import { LINE_TRIGGERS, restoreLineCells } from "../utils/gameShared";
import {
  RETURN_MS,
  SPEED,
  STROKE_WIDTH,
  SWEEP_STEP,
} from "../utils/gridConfig";
import {
  appendBody,
  appendHead,
  canvasToCell,
  pointAtLength,
} from "../utils/lineBatch";
import {
  FLIGHT_GEOM,
  SLOT_LINE,
  SLOT_PREVLEN,
  SLOT_PROGRESS,
  SLOT_SETTLED,
} from "../utils/flightPool";

/**
 * Walk every cell the head crossed between `fromLen` and `toLen` and return
 * the arc-length at which it first meets another line, or -1 if the span is
 * clear.
 *
 * Returning the *contact length* rather than a boolean means the arrow can be
 * parked exactly where it made contact, instead of wherever the frame boundary
 * happened to land — no more visible overshoot before the bounce.
 */
function firstHit(flat, cum, total, ang, id, fromLen, toLen) {
  "worklet";
  const grid = LINE_TRIGGERS.value;
  if (!grid) return -1;

  const rows = grid.length;
  const cols = grid[0].length;
  const scratch = { x: 0, y: 0 };
  const cell = { row: 0, col: 0 };

  const span = toLen - fromLen;
  const steps = Math.max(1, Math.ceil(span / SWEEP_STEP));

  let lastRow = -1;
  let lastCol = -1;

  for (let s = 1; s <= steps; s++) {
    const t = fromLen + (span * s) / steps;
    const p = pointAtLength(flat, cum, total, ang, t, scratch);
    canvasToCell(p.x, p.y, cell);

    // Consecutive samples often land in the same cell; skip the repeat lookup.
    if (cell.row === lastRow && cell.col === lastCol) continue;
    lastRow = cell.row;
    lastCol = cell.col;

    if (cell.row < 0 || cell.row >= rows || cell.col < 0 || cell.col >= cols) {
      continue;
    }

    const hit = grid[cell.row][cell.col];
    if (hit && hit !== id) return t;
  }

  return -1;
}

export default function FlightSlot({ index, onDone }) {
  // Bind THIS slot's shared values to locals before any worklet closes over
  // them. Writing SLOT_PROGRESS[index].value inside the worklet would capture
  // the whole ARRAY, making all POOL_SIZE slots mapper inputs for every slot —
  // one moving arrow would then recompute all twelve every frame.
  const line = SLOT_LINE[index];
  const progress = SLOT_PROGRESS[index];
  const settled = SLOT_SETTLED[index];
  const prevLen = SLOT_PREVLEN[index];

  const bodyPath = useDerivedValue(() => {
    const p = Skia.Path.Make();

    const g = FLIGHT_GEOM.value;
    const i = line.value;
    if (!g || i < 0) return p; // slot idle — draw nothing

    const flat = g.pts[i];
    const cum = g.cum[i];
    const total = g.total[i];
    const ang = g.ang[i];
    const id = g.ids[i];

    let headLen = progress.value * SPEED + total;

    if (!settled.value) {
      const contact = firstHit(
        flat,
        cum,
        total,
        ang,
        id,
        prevLen.value,
        headLen,
      );

      if (contact >= 0) {
        settled.value = true;
        // Park exactly at the contact point, then retreat from there.
        headLen = contact;
        progress.value = (contact - total) / SPEED;
        progress.value = withTiming(
          0,
          { duration: RETURN_MS, easing: Easing.linear },
          (done) => {
            "worklet";
            // Slot was reset under us (new puzzle / restart). Dropping this is
            // what stops a dead board's arrow from writing cells back into a
            // freshly built trigger grid.
            if (line.value !== i) return;

            // THE GHOST FIX. The tap handler clears this line's cells on the
            // prediction that it will escape. It just didn't - so put them
            // back. Without this the arrow returns to rest visible but absent
            // from the trigger grid: untappable, and every other arrow flies
            // straight through it.
            restoreLineCells(id);
            line.value = -1;
            if (done) runOnJS(onDone)(id, false);
          },
        );
      }
    }

    prevLen.value = headLen;

    appendBody(p, flat, cum, total, ang, headLen - total, headLen, {
      x: 0,
      y: 0,
    });
    return p;
  });

  const headPath = useDerivedValue(() => {
    const p = Skia.Path.Make();

    const g = FLIGHT_GEOM.value;
    const i = line.value;
    if (!g || i < 0) return p;

    const headLen = progress.value * SPEED + g.total[i];
    const h = pointAtLength(
      g.pts[i],
      g.cum[i],
      g.total[i],
      g.ang[i],
      headLen,
      { x: 0, y: 0 },
    );
    appendHead(p, h.x, h.y, g.ang[i]);
    return p;
  });

  // Colour follows whichever line the slot currently holds. An idle slot draws
  // empty paths anyway; "transparent" just keeps it honest.
  const color = useDerivedValue(() => {
    const g = FLIGHT_GEOM.value;
    const i = line.value;
    if (!g || i < 0) return "transparent";
    return g.lineColor[i];
  });

  return (
    <>
      <Path
        path={bodyPath}
        color={color}
        style="stroke"
        strokeWidth={STROKE_WIDTH}
        strokeCap="round"
        strokeJoin="round"
      />
      <Path path={headPath} color={color} style="fill" />
    </>
  );
}
