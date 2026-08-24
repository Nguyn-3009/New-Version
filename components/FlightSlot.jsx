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

import { Group, Path, Skia } from "@shopify/react-native-skia";
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
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

// Returned by an idle slot, and never mutated. Reanimated dedupes shared-value
// writes by identity (valueSetter bails when `_value === value`), so handing
// back the SAME empty path every frame means an idle slot never notifies the
// renderer at all.
const EMPTY_PATH = Skia.Path.Make();

// Phase 1 and idle both draw in absolute world coordinates. Same identity
// trick: a constant means no write, so no redraw.
const NO_SHIFT = [{ translateX: 0 }, { translateY: 0 }];

/**
 * Geometry that does not change for the duration of one flight.
 *
 * THE OBSERVATION THIS RESTS ON: appendBody is always asked for the window
 * [headLen - total, headLen], which is *exactly* `total` long, every frame. The
 * body is therefore a RIGID shape sliding forward, not a shape that morphs -
 * and once headLen passes 2*total the tail has cleared the last turn point, so
 * that rigid shape is a plain straight segment along the escape direction.
 *
 * From then to the end of the flight the path is constant and only its
 * position changes, which a transform can do for free. Escape rays run
 * MAX_PROGRESS*SPEED = 2560px against bodies of typically 60-180px, so this
 * covers roughly 95% of the frames of a flight.
 */
function buildRigid(g, i) {
  "worklet";
  const flat = g.pts[i];
  const cum = g.cum[i];
  const total = g.total[i];
  const ang = g.ang[i];

  const n = cum.length;
  const ex = flat[(n - 1) * 2];
  const ey = flat[(n - 1) * 2 + 1];
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);

  // Body at the moment the tail leaves the polyline: a straight segment of
  // length `total` starting at the polyline's end. A 1-cell arrow has
  // total === 0, so this is a degenerate segment - which is exactly how
  // recordOneTile draws one at rest, and the round cap makes it a dot.
  const body = Skia.Path.Make();
  body.moveTo(ex, ey);
  body.lineTo(ex + dx * total, ey + dy * total);

  // Arrowhead where it sits at rest. It rides `headLen - total` along the ray,
  // which is 0 at progress 0, so the head is rigid for the WHOLE flight - it
  // never needed rebuilding even during the peel.
  const head = Skia.Path.Make();
  appendHead(head, ex, ey, ang);

  return { forLine: i, body, head, dx, dy, total };
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

  // The head arc-length for THIS frame, written by bodyPath and read by both
  // transforms.
  //
  // Making the transforms depend on it is what pins the execution order:
  // Reanimated runs a mapper before the ones that read its output. On the frame
  // a bounce is detected, headLen is overridden to the exact contact point, and
  // a transform that recomputed it from progress on its own could run first and
  // render the arrow a frame PAST the blocker - the overshoot the contact-length
  // logic exists to prevent.
  const headLenSV = useSharedValue(0);

  // Rigid geometry for the flight currently in this slot.
  const rigid = useSharedValue(null);

  const bodyPath = useDerivedValue(() => {
    const g = FLIGHT_GEOM.value;
    const i = line.value;
    if (!g || i < 0) return EMPTY_PATH; // slot idle — draw nothing

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
    headLenSV.value = headLen;

    let r = rigid.value;
    if (!r || r.forLine !== i) {
      r = buildRigid(g, i);
      rigid.value = r;
    }

    // Tail has cleared the last turn point: the body is the constant straight
    // segment, and the transform below slides it. Returning the SAME object
    // means Reanimated skips the write entirely, so the renderer never re-reads
    // the path and no Skia object is allocated for the rest of the flight.
    if (headLen >= 2 * total) return r.body;

    // Still peeling off the corners, where the shape genuinely does change.
    // Short: this is roughly the first `total` pixels of a 2560px flight.
    const p = Skia.Path.Make();
    appendBody(p, flat, cum, total, ang, headLen - total, headLen, {
      x: 0,
      y: 0,
    });
    return p;
  });

  // Body slides only once it has gone rigid; during the peel bodyPath is
  // already in absolute coordinates, so the transform must stay identity.
  const bodyTransform = useDerivedValue(() => {
    const r = rigid.value;
    if (!r || line.value < 0) return NO_SHIFT;
    const s = headLenSV.value - 2 * r.total;
    if (s <= 0) return NO_SHIFT;
    return [{ translateX: r.dx * s }, { translateY: r.dy * s }];
  });

  // The head is rigid from the first frame, so this one is never identity-only
  // for shape reasons - just position.
  const headPath = useDerivedValue(() => {
    const i = line.value;
    const r = rigid.value;
    if (i < 0 || !r || r.forLine !== i) return EMPTY_PATH;
    return r.head;
  });

  const headTransform = useDerivedValue(() => {
    const r = rigid.value;
    if (!r || line.value < 0) return NO_SHIFT;
    const s = headLenSV.value - r.total;
    if (s <= 0) return NO_SHIFT;
    return [{ translateX: r.dx * s }, { translateY: r.dy * s }];
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
      <Group transform={bodyTransform}>
        <Path
          path={bodyPath}
          color={color}
          style="stroke"
          strokeWidth={STROKE_WIDTH}
          strokeCap="round"
          strokeJoin="round"
        />
      </Group>
      <Group transform={headTransform}>
        <Path path={headPath} color={color} style="fill" />
      </Group>
    </>
  );
}
