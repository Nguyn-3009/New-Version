// Replaces N <SkiaLine> components with 3 Skia nodes per palette colour.
//
// Lives outside app/ on purpose: anything under app/ is a route as far as
// expo-router is concerned, which is why the old SkiaLine needed an
// `href: null` entry in the tab layout — and why it ended up in a require
// cycle with the screen that owned its shared values.
//
// Layering, per colour:
//
//   base     every line's full geometry @ 0.2 — pure useMemo, JS thread,
//            rebuilt only when the puzzle changes. Free at runtime.
//   resting  lines that aren't animating, frozen at their current progress
//            (0 for untouched, MAX for escaped). Rebuilt on staticEpoch,
//            which bumps roughly twice per tap.
//   active   lines currently in flight. Rebuilt on frameTick, i.e. every
//            frame — but it only ever contains the handful of arrows that
//            are actually moving.
//
// That split is what makes this cheap. A naive "one path per colour, rebuilt
// every frame" version still walks all 875 polylines at 60fps; this one walks
// however many arrows you've actually launched.

import React, { useMemo } from "react";
import { Path, Skia } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import {
  COMPILED,
  LINE_MOVING,
  LINE_RETURNING,
  activeList,
  frameTick,
  lineState,
  progress,
  staticEpoch,
} from "../utils/gameShared";
import { BASE_OPACITY, SPEED, STROKE_WIDTH } from "../utils/gridConfig";
import { appendBody, appendHead, pointAtLength } from "../utils/lineBatch";

function ColorLayer({ colorIndex, color, compiled }) {
  // --- base: never changes for the life of a puzzle -------------------------
  const basePath = useMemo(() => {
    const p = Skia.Path.Make();
    const idxs = compiled.byColor[colorIndex];
    for (let k = 0; k < idxs.length; k++) {
      const flat = compiled.pts[idxs[k]];
      const n = flat.length / 2;
      p.moveTo(flat[0], flat[1]);
      for (let j = 1; j < n; j++) p.lineTo(flat[j * 2], flat[j * 2 + 1]);
    }
    return p;
  }, [compiled, colorIndex]);

  // --- resting: rebuilt on staticEpoch only --------------------------------
  const restingBody = useDerivedValue(() => {
    const epoch = staticEpoch.value; // dependency
    const p = Skia.Path.Make();
    const C = COMPILED.value;
    if (!C || epoch < 0) return p;

    const st = lineState.value;
    const prog = progress.value;
    const idxs = C.byColor[colorIndex];
    if (!idxs) return p;

    const scratch = { x: 0, y: 0 };
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      const s = st[i];
      if (s === LINE_MOVING || s === LINE_RETURNING) continue;
      const flat = C.pts[i];
      const cumArr = C.cum[i];
      const total = C.total[i];
      const angle = C.ang[i];
      const headLen = prog[i] * SPEED + total;
      appendBody(
        p,
        flat,
        cumArr,
        total,
        angle,
        headLen - total,
        headLen,
        scratch,
      );
    }
    return p;
  }, [compiled, colorIndex]);

  const restingHeads = useDerivedValue(() => {
    const epoch = staticEpoch.value; // dependency
    const p = Skia.Path.Make();
    const C = COMPILED.value;
    if (!C || epoch < 0) return p;

    const st = lineState.value;
    const prog = progress.value;
    const idxs = C.byColor[colorIndex];
    if (!idxs) return p;

    const scratch = { x: 0, y: 0 };
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      const s = st[i];
      if (s === LINE_MOVING || s === LINE_RETURNING) continue;
      const headLen = prog[i] * SPEED + C.total[i];
      const h = pointAtLength(
        C.pts[i],
        C.cum[i],
        C.total[i],
        C.ang[i],
        headLen,
        scratch,
      );
      appendHead(p, h.x, h.y, C.ang[i]);
    }
    return p;
  }, [compiled, colorIndex]);

  // --- active: rebuilt every frame, but only for arrows in flight ----------
  const activeBody = useDerivedValue(() => {
    const tick = frameTick.value; // dependency
    const p = Skia.Path.Make();
    const C = COMPILED.value;
    if (!C || tick < 0) return p;

    const act = activeList.value;
    const prog = progress.value;
    const scratch = { x: 0, y: 0 };

    for (let k = 0; k < act.length; k++) {
      const i = act[k];
      if (C.colorIdx[i] !== colorIndex) continue;
      const flat = C.pts[i];
      const cumArr = C.cum[i];
      const total = C.total[i];
      const angle = C.ang[i];
      const headLen = prog[i] * SPEED + total;
      appendBody(
        p,
        flat,
        cumArr,
        total,
        angle,
        headLen - total,
        headLen,
        scratch,
      );
    }
    return p;
  }, [compiled, colorIndex]);

  const activeHeads = useDerivedValue(() => {
    const tick = frameTick.value; // dependency
    const p = Skia.Path.Make();
    const C = COMPILED.value;
    if (!C || tick < 0) return p;

    const act = activeList.value;
    const prog = progress.value;
    const scratch = { x: 0, y: 0 };

    for (let k = 0; k < act.length; k++) {
      const i = act[k];
      if (C.colorIdx[i] !== colorIndex) continue;
      const headLen = prog[i] * SPEED + C.total[i];
      const h = pointAtLength(
        C.pts[i],
        C.cum[i],
        C.total[i],
        C.ang[i],
        headLen,
        scratch,
      );
      appendHead(p, h.x, h.y, C.ang[i]);
    }
    return p;
  }, [compiled, colorIndex]);

  return (
    <>
      <Path
        path={basePath}
        color={color}
        style="stroke"
        strokeWidth={STROKE_WIDTH}
        opacity={BASE_OPACITY}
      />
      <Path
        path={restingBody}
        color={color}
        style="stroke"
        strokeWidth={STROKE_WIDTH}
      />
      <Path path={restingHeads} color={color} style="fill" />
      <Path
        path={activeBody}
        color={color}
        style="stroke"
        strokeWidth={STROKE_WIDTH}
      />
      <Path path={activeHeads} color={color} style="fill" />
    </>
  );
}

export default function BatchedLines({ compiled }) {
  if (!compiled || compiled.count === 0) return null;

  return (
    <>
      {compiled.colors.map((color, k) => (
        <ColorLayer
          key={color}
          colorIndex={k}
          color={color}
          compiled={compiled}
        />
      ))}
    </>
  );
}