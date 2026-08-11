// One animated arrow, mounted only while its line is in flight.
//
// The collision test here is SWEPT, not point-sampled. That distinction is the
// whole fix for "the arrow passes straight through a blocker": at
// MAX_PROGRESS=32 the head advances ~2.1 grid cells per frame, so checking
// only where the head *is* skips every other cell. Whether a blocker was seen
// came down to where it happened to fall relative to the sampling stride,
// which is why the bug looked intermittent.

import { useEffect, useMemo } from "react";
import { Path, Skia } from "@shopify/react-native-skia";
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { LINE_TRIGGERS, restoreLineCells } from "../utils/gameShared";
import {
  FORWARD_MS,
  MAX_PROGRESS,
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

export default function FlightLine({ id, geom, color, onDone }) {
  const { flat, cum, total, ang } = geom;

  const progress = useSharedValue(0);
  const settled = useSharedValue(false);
  // Arc-length of the head at the previous frame, so the sweep knows what span
  // to cover. Starts at `total`, i.e. progress 0.
  const prevLen = useSharedValue(total);

  useEffect(() => {
    progress.value = withTiming(
      MAX_PROGRESS,
      { duration: FORWARD_MS, easing: Easing.linear },
      (finished) => {
        "worklet";
        if (finished && !settled.value) {
          settled.value = true;
          // Cells were already freed at tap time so other arrows can use the
          // corridor immediately - waiting a full second before clearing made
          // every following tap bounce, which felt like input lag.
          runOnJS(onDone)(id, true);
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bodyPath = useDerivedValue(() => {
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
        const contactProgress = (contact - total) / SPEED;
        progress.value = contactProgress;
        progress.value = withTiming(
          0,
          { duration: RETURN_MS, easing: Easing.linear },
          (done) => {
            "worklet";
            // THE GHOST FIX. The tap handler clears this line's cells on the
            // prediction that it will escape. It just didn't - so put them
            // back. Without this the arrow returns to rest visible but absent
            // from the trigger grid: untappable, and every other arrow flies
            // straight through it.
            restoreLineCells(id);
            if (done) runOnJS(onDone)(id, false);
          },
        );
      }
    }

    prevLen.value = headLen;

    const p = Skia.Path.Make();
    appendBody(p, flat, cum, total, ang, headLen - total, headLen, {
      x: 0,
      y: 0,
    });
    return p;
  });

  const headPath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const headLen = progress.value * SPEED + total;
    const h = pointAtLength(flat, cum, total, ang, headLen, { x: 0, y: 0 });
    appendHead(p, h.x, h.y, ang);
    return p;
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
