// Records every at-rest line into ONE Skia.Picture, on the JS thread.
//
// This is the piece that makes puzzle size stop mattering. A Picture is
// recorded once and replayed by the GPU each frame for free, so 1411 resting
// lines cost the same per frame as 2. Nothing here runs in a worklet, nothing
// here is a shared value, so no mapper can be triggered by it.
//
// Re-recorded only when the set of in-flight lines changes — twice per tap.
// That work lands on the JS thread, off the animation path entirely.

import { Skia } from "@shopify/react-native-skia";

import {
  BASE_OPACITY,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  GRID_OFFSET_X,
  GRID_OFFSET_Y,
  STROKE_WIDTH,
} from "./gridConfig";
import { appendHead } from "./lineBatch";

/**
 * @param {ReturnType<import("./lineBatch").compileLines>} compiled
 * @param {Set<string>} flyingIds  lines currently animated by a FlightLine
 * @param {Set<string>} escapedIds lines that have flown off for good
 */
export function recordRestingPicture(compiled, flyingIds, escapedIds) {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(
    Skia.XYWHRect(
      0,
      0,
      CANVAS_WIDTH + 2 * GRID_OFFSET_X,
      CANVAS_HEIGHT + 2 * GRID_OFFSET_Y,
    ),
  );

  if (!compiled || compiled.count === 0) {
    return recorder.finishRecordingAsPicture();
  }

  const K = compiled.colors.length;

  // One path per colour per role, so the whole board is 3 * K draw calls.
  const basePaths = [];
  const bodyPaths = [];
  const headPaths = [];
  for (let k = 0; k < K; k++) {
    basePaths.push(Skia.Path.Make());
    bodyPaths.push(Skia.Path.Make());
    headPaths.push(Skia.Path.Make());
  }

  for (let i = 0; i < compiled.count; i++) {
    const k = compiled.colorIdx[i];
    const flat = compiled.pts[i];
    const n = flat.length / 2;

    // Ghost: drawn for every line, always, so a departed arrow leaves its
    // track behind exactly like the old 0.2-opacity base <Path> did.
    const base = basePaths[k];
    base.moveTo(flat[0], flat[1]);
    for (let j = 1; j < n; j++) base.lineTo(flat[j * 2], flat[j * 2 + 1]);

    const id = compiled.ids[i];
    if (flyingIds.has(id) || escapedIds.has(id)) continue;

    // Solid arrow, at rest: full body plus its head on the last vertex.
    const body = bodyPaths[k];
    body.moveTo(flat[0], flat[1]);
    for (let j = 1; j < n; j++) body.lineTo(flat[j * 2], flat[j * 2 + 1]);

    appendHead(
      headPaths[k],
      flat[(n - 1) * 2],
      flat[(n - 1) * 2 + 1],
      compiled.ang[i],
    );
  }

  for (let k = 0; k < K; k++) {
    const color = Skia.Color(compiled.colors[k]);

    const ghost = Skia.Paint();
    ghost.setColor(color);
    ghost.setAlphaf(BASE_OPACITY);
    ghost.setStyle(1); // stroke
    ghost.setStrokeWidth(STROKE_WIDTH);
    ghost.setAntiAlias(true);
    canvas.drawPath(basePaths[k], ghost);

    const stroke = Skia.Paint();
    stroke.setColor(color);
    stroke.setStyle(1); // stroke
    stroke.setStrokeWidth(STROKE_WIDTH);
    stroke.setAntiAlias(true);
    canvas.drawPath(bodyPaths[k], stroke);

    const fill = Skia.Paint();
    fill.setColor(color);
    fill.setAntiAlias(true);
    canvas.drawPath(headPaths[k], fill);
  }

  return recorder.finishRecordingAsPicture();
}