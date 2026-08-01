// One animated arrow. This is the old SkiaLine, with the important difference
// that it is mounted ONLY while its line is actually moving.
//
// The original problem was never that this component was slow — it's that 1411
// of them existed simultaneously, each holding two shared values, two animated
// reactions and three derived values, and each waking up on every onTap bump.
// Everything at rest now lives in a single pre-recorded Picture, so this is
// only ever instantiated one to three times at once.
//
// Because the count is small and JS-driven, `color` can be a plain string prop
// again rather than something the UI thread has to look up.

import { useEffect, useMemo } from "react";
import { Path, Skia } from "@shopify/react-native-skia";
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { LINE_TRIGGERS } from "../utils/gameShared";
import {
  FORWARD_MS,
  MAX_PROGRESS,
  RETURN_MS,
  SPEED,
  STROKE_WIDTH,
} from "../utils/gridConfig";
import {
  appendBody,
  appendHead,
  canvasToCell,
  pointAtLength,
} from "../utils/lineBatch";

export default function FlightLine({ id, geom, color, onDone }) {
  const { flat, cum, total, ang } = geom;

  const progress = useSharedValue(0);
  // Latches the moment this arrow's fate is decided — either it hit something
  // and is bouncing back, or it ran its full course. Stops the collision test
  // re-firing on the way home and stops onDone being reported twice.
  const settled = useSharedValue(false);

  useEffect(() => {
    progress.value = withTiming(
      MAX_PROGRESS,
      { duration: FORWARD_MS, easing: Easing.linear },
      (finished) => {
        "worklet";
        if (finished && !settled.value) {
          settled.value = true;
          runOnJS(onDone)(id, true); // escaped
        }
      },
    );
    // Mount-only: a FlightLine exists for exactly one flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bodyPath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const headLen = progress.value * SPEED + total;
    const scratch = { x: 0, y: 0 };

    if (!settled.value) {
      const h = pointAtLength(flat, cum, total, ang, headLen, scratch);
      const cell = canvasToCell(h.x, h.y, { row: 0, col: 0 });
      const grid = LINE_TRIGGERS.value;

      let hit = null;
      if (
        grid &&
        cell.row >= 0 &&
        cell.row < grid.length &&
        cell.col >= 0 &&
        cell.col < grid[0].length
      ) {
        hit = grid[cell.row][cell.col];
      }

      if (hit && hit !== id) {
        settled.value = true;
        progress.value = withTiming(
          0,
          { duration: RETURN_MS, easing: Easing.linear },
          (done) => {
            "worklet";
            if (done) runOnJS(onDone)(id, false); // bounced, back at rest
          },
        );
      }
    }

    appendBody(p, flat, cum, total, ang, headLen - total, headLen, scratch);
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
      />
      <Path path={headPath} color={color} style="fill" />
    </>
  );
}
