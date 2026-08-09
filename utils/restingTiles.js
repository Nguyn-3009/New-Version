// Tiled resting board.
//
// THE PROBLEM THIS SOLVES
//
// The previous version recorded every at-rest arrow into ONE Skia.Picture
// whose cull rect covered the entire world:
//
//   recorder.beginRecording(Skia.XYWHRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT))
//
// A cull rect is Skia's only hint about where a Picture's contents live. By
// declaring "the whole world", that Picture became opaque to the culler: when
// zoomed into one corner, Skia still had to walk all ~12,600 turn points every
// frame, because nothing told it 96% of them were off-screen.
//
// Splitting the board into a grid of Pictures, each recorded with an honest
// cull rect covering only its own tile, lets Skia quick-reject the off-screen
// ones. No JS visibility calculation, no re-render while panning, no camera
// state crossing threads - the rejection happens inside drawPicture.
//
// At 5x zoom you see roughly 1/25 of the board, so 20+ of 25 tiles cost
// nothing beyond a rect comparison.
//
// NOTE ON DUPLICATES: an arrow whose bounding box spans several tiles is
// recorded into each of them. It gets drawn once per visible tile it touches,
// which is harmless - same geometry, same opaque colour, identical result -
// and it avoids needing padded visibility ranges.

import { Skia } from "@shopify/react-native-skia";

import {
  STROKE_WIDTH,
  TILES_PER_AXIS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./gridConfig";
import { appendHead } from "./lineBatch";

/**
 * @returns {{picture: SkPicture}[]} one entry per non-empty tile
 */
export function recordRestingTiles(compiled, flyingIds, escapedIds) {
  if (!compiled || compiled.count === 0) return [];

  const tileW = WORLD_WIDTH / TILES_PER_AXIS;
  const tileH = WORLD_HEIGHT / TILES_PER_AXIS;
  const K = compiled.colors.length;

  // buckets[tileIndex] = array of line indices whose bbox touches that tile
  const buckets = new Array(TILES_PER_AXIS * TILES_PER_AXIS);
  for (let t = 0; t < buckets.length; t++) buckets[t] = null;

  for (let i = 0; i < compiled.count; i++) {
    const id = compiled.ids[i];
    if (flyingIds.has(id) || escapedIds.has(id)) continue;

    const flat = compiled.pts[i];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < flat.length; j += 2) {
      const x = flat[j];
      const y = flat[j + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Pad by the stroke and the arrowhead so a tile's cull rect never clips
    // geometry that visually belongs to it.
    const pad = STROKE_WIDTH + 24;

    const c0 = clampTile(Math.floor((minX - pad) / tileW));
    const c1 = clampTile(Math.floor((maxX + pad) / tileW));
    const r0 = clampTile(Math.floor((minY - pad) / tileH));
    const r1 = clampTile(Math.floor((maxY + pad) / tileH));

    for (let tr = r0; tr <= r1; tr++) {
      for (let tc = c0; tc <= c1; tc++) {
        const t = tr * TILES_PER_AXIS + tc;
        if (!buckets[t]) buckets[t] = [];
        buckets[t].push(i);
      }
    }
  }

  const tiles = [];

  for (let t = 0; t < buckets.length; t++) {
    const idxs = buckets[t];
    if (!idxs || idxs.length === 0) continue; // empty tile: record nothing

    const tr = Math.floor(t / TILES_PER_AXIS);
    const tc = t % TILES_PER_AXIS;
    const pad = STROKE_WIDTH + 24;

    const recorder = Skia.PictureRecorder();
    // The honest cull rect. This is the entire point of the exercise.
    const canvas = recorder.beginRecording(
      Skia.XYWHRect(
        tc * tileW - pad,
        tr * tileH - pad,
        tileW + pad * 2,
        tileH + pad * 2,
      ),
    );

    const bodyPaths = [];
    const headPaths = [];
    for (let k = 0; k < K; k++) {
      bodyPaths.push(Skia.Path.Make());
      headPaths.push(Skia.Path.Make());
    }

    for (let n = 0; n < idxs.length; n++) {
      const i = idxs[n];
      const k = compiled.colorIdx[i];
      const flat = compiled.pts[i];
      const pointCount = flat.length / 2;

      const body = bodyPaths[k];
      body.moveTo(flat[0], flat[1]);
      for (let j = 1; j < pointCount; j++) {
        body.lineTo(flat[j * 2], flat[j * 2 + 1]);
      }
      // A 1-cell arrow is a single point; a bare moveTo draws nothing, so give
      // it a zero-length segment that a round cap renders as a dot.
      if (pointCount === 1) body.lineTo(flat[0], flat[1]);

      appendHead(
        headPaths[k],
        flat[(pointCount - 1) * 2],
        flat[(pointCount - 1) * 2 + 1],
        compiled.ang[i],
      );
    }

    for (let k = 0; k < K; k++) {
      if (bodyPaths[k].isEmpty() && headPaths[k].isEmpty()) continue;
      const color = Skia.Color(compiled.colors[k]);

      const stroke = Skia.Paint();
      stroke.setColor(color);
      stroke.setStyle(1); // stroke
      stroke.setStrokeWidth(STROKE_WIDTH);
      stroke.setStrokeCap(1); // round
      stroke.setStrokeJoin(1); // round
      stroke.setAntiAlias(true);
      canvas.drawPath(bodyPaths[k], stroke);

      const fill = Skia.Paint();
      fill.setColor(color);
      fill.setAntiAlias(true);
      canvas.drawPath(headPaths[k], fill);
    }

    tiles.push({ key: t, picture: recorder.finishRecordingAsPicture() });
  }

  return tiles;
}

function clampTile(v) {
  return Math.max(0, Math.min(TILES_PER_AXIS - 1, v));
}