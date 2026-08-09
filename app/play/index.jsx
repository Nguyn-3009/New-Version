import { StyleSheet, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import {
  runOnJS,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { Canvas, Group, Picture, Skia } from "@shopify/react-native-skia";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";

import { LINES as STATIC_LINES } from "../../utils/LINE_TRIGGER";
import {
  getGridColors,
  getGeneratedLines,
  getPuzzleVersion,
} from "../../utils/gridImageStore";
import FlightLine from "../../components/FlightLine";
import { compileLines } from "../../utils/lineBatch";
import { recordRestingTiles } from "../../utils/restingTiles";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_DOT_COLOR,
  DOT_RADIUS,
  DOT_SPACING,
  GRID_COLS,
  GRID_OFFSET_X,
  GRID_OFFSET_Y,
  GRID_ROWS,
  HITBOX,
  MAX_SCALE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../../utils/gridConfig";
import {
  LINE_DIRS,
  LINE_DOTS_MAP,
  LINE_TRIGGERS,
  onTap,
} from "../../utils/gameShared";

// ---------------------------------------------------------------------------
// Puzzle loading
// ---------------------------------------------------------------------------

function expandSegments(points) {
  const allDots = [];

  // A 1-cell arrow has a single point and therefore no segments. Without this
  // it would expand to [] and never be registered in the trigger grid, i.e.
  // it would be invisible to taps.
  if (points.length === 1) {
    return [{ row: points[0].row, col: points[0].col }];
  }

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];

    if (from.row === to.row) {
      const step = from.col < to.col ? 1 : -1;
      for (let c = from.col; ; c += step) {
        allDots.push({ row: from.row, col: c });
        if (c === to.col) break;
      }
    } else if (from.col === to.col) {
      const step = from.row < to.row ? 1 : -1;
      for (let r = from.row; ; r += step) {
        allDots.push({ row: r, col: from.col });
        if (r === to.row) break;
      }
    } else {
      console.warn("Diagonal lines not supported yet");
    }
  }

  return allDots;
}

function buildTriggerGrid(lines) {
  const grid = Array.from({ length: GRID_ROWS }, () =>
    Array(GRID_COLS).fill(null),
  );

  let dropped = 0;
  for (const line of lines) {
    for (const { row, col } of expandSegments(line.points)) {
      // Bounds check: without it, a constant changed three files away turns
      // into an unrecoverable module-scope crash with a useless message.
      if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
        dropped++;
        continue;
      }
      grid[row][col] = line.id;
    }
  }
  if (dropped > 0) {
    console.warn(
      `buildTriggerGrid: ${dropped} dots outside ${GRID_ROWS}x${GRID_COLS} grid`,
    );
  }
  return grid;
}

function buildLineDotsMap(lines) {
  return lines.reduce((acc, line) => {
    acc[line.id] = expandSegments(line.points);
    return acc;
  }, {});
}

function buildLineDirs(lines) {
  return lines.reduce((acc, line) => {
    if (line.dir) {
      acc[line.id] = line.dir;
    } else {
      // Fallback for static/legacy line data without an explicit direction.
      const p = line.points;
      const last = p[p.length - 1];
      const prev = p[p.length - 2] ?? last;
      const dr = Math.sign(last.row - prev.row);
      const dc = Math.sign(last.col - prev.col);
      acc[line.id] = { dr, dc };
    }
    return acc;
  }, {});
}

function getActiveLinesSnapshot() {
  return getGeneratedLines() ?? STATIC_LINES;
}

function loadPuzzle(lines) {
  LINE_TRIGGERS.value = buildTriggerGrid(lines);
  LINE_DOTS_MAP.value = buildLineDotsMap(lines);
  LINE_DIRS.value = buildLineDirs(lines);
  onTap.value = 0;
  return compileLines(lines);
}

// ---------------------------------------------------------------------------
// Escape logic
// ---------------------------------------------------------------------------

function isThrough(lineId) {
  "worklet";
  const dots = LINE_DOTS_MAP.value[lineId];
  const last = dots[dots.length - 1];
  // Direction now comes from the line data, not from the last two dots -
  // a 1-cell arrow has only one dot.
  const d = LINE_DIRS.value[lineId];
  const dRow = d.dr;
  const dCol = d.dc;

  let row = last.row + dRow;
  let col = last.col + dCol;

  while (row >= 0 && col >= 0 && row < GRID_ROWS && col < GRID_COLS) {
    const hit = LINE_TRIGGERS.value[row][col];
    if (hit && hit !== lineId) return false;
    row += dRow;
    col += dCol;
  }
  return true;
}

function clearId(lineId) {
  "worklet";
  for (const { row, col } of LINE_DOTS_MAP.value[lineId]) {
    LINE_TRIGGERS.value[row][col] = null;
  }
}

// ---------------------------------------------------------------------------

export default function AnimatedDashedLines() {
  // photoReady is no longer read - the store version drives puzzle reloads.
  const { restart } = useLocalSearchParams();

  const [photoGridColors, setPhotoGridColors] = useState(() => getGridColors());
  const [compiled, setCompiled] = useState(() =>
    loadPuzzle(getActiveLinesSnapshot()),
  );
  const [flights, setFlights] = useState([]);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  const escapedRef = useRef(new Set());
  const activeLinesRef = useRef(getActiveLinesSnapshot());

  // -------------------------------------------------------------------------
  // Camera. World -> screen is:  screen = world * scale + translate
  // The Skia surface is now viewport-sized; this transform is what brings the
  // 2580x2580 world into it, instead of allocating a 2580x2580 surface.
  // -------------------------------------------------------------------------
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);

  // Smallest scale that still fits the whole board on screen. Also the floor,
  // so you can never zoom out into empty space.
  const minScale = useMemo(() => {
    if (!viewport.w || !viewport.h) return 1;
    return Math.min(viewport.w / WORLD_WIDTH, viewport.h / WORLD_HEIGHT);
  }, [viewport]);

  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ w: width, h: height });
  }, []);

  // Start zoomed out far enough to see the entire board.
  useEffect(() => {
    if (!viewport.w || !viewport.h) return;
    scale.value = minScale;
    tx.value = (viewport.w - WORLD_WIDTH * minScale) / 2;
    ty.value = (viewport.h - WORLD_HEIGHT * minScale) / 2;
  }, [viewport, minScale, scale, tx, ty]);

  const clampCamera = useCallback(
    (s, x, y) => {
      "worklet";
      const sw = WORLD_WIDTH * s;
      const sh = WORLD_HEIGHT * s;
      // If the board is smaller than the viewport on an axis, centre it.
      // Otherwise keep its edges from pulling inside the viewport.
      const cx =
        sw <= viewport.w
          ? (viewport.w - sw) / 2
          : Math.min(0, Math.max(viewport.w - sw, x));
      const cy =
        sh <= viewport.h
          ? (viewport.h - sh) / 2
          : Math.min(0, Math.max(viewport.h - sh, y));
      return { x: cx, y: cy };
    },
    [viewport],
  );

  const panGesture = Gesture.Pan()
    .onStart(() => {
      "worklet";
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      "worklet";
      const c = clampCamera(
        scale.value,
        startTx.value + e.translationX,
        startTy.value + e.translationY,
      );
      tx.value = c.x;
      ty.value = c.y;
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      "worklet";
      startScale.value = scale.value;
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      "worklet";
      const next = Math.min(
        MAX_SCALE,
        Math.max(minScale, startScale.value * e.scale),
      );
      // Keep the point under the fingers pinned while scaling.
      const k = next / startScale.value;
      const c = clampCamera(
        next,
        e.focalX - k * (e.focalX - startTx.value),
        e.focalY - k * (e.focalY - startTy.value),
      );
      scale.value = next;
      tx.value = c.x;
      ty.value = c.y;
    });

  // -------------------------------------------------------------------------
  // Flight bookkeeping
  // -------------------------------------------------------------------------

  const reload = useCallback((lines) => {
    activeLinesRef.current = lines;
    escapedRef.current = new Set();
    setFlights([]);
    setCompiled(loadPuzzle(lines));
  }, []);

  // Which puzzle version is currently on screen. Compared against the store
  // every time this screen gains focus, so a new puzzle can never sit in the
  // store while a stale one is rendered - regardless of how you navigated
  // here, and regardless of whether this screen stayed mounted.
  const shownVersionRef = useRef(-1);

  useFocusEffect(
    useCallback(() => {
      const version = getPuzzleVersion();
      if (version === shownVersionRef.current) return;

      const newLines = getGeneratedLines();
      if (!newLines) return;

      shownVersionRef.current = version;
      setPhotoGridColors(getGridColors());
      console.log("🖼️ New photo-generated lines loaded:", newLines.length);
      reload(newLines);
    }, [reload]),
  );

  useEffect(() => {
    if (!restart) return;
    console.log("🔄 Full Game Reset Triggered!");
    reload(activeLinesRef.current);
  }, [restart, reload]);

  const startFlight = useCallback(
    (lineId) => {
      const i = compiled.indexById[lineId];
      if (i === undefined || escapedRef.current.has(lineId)) return;
      setFlights((prev) => {
        if (prev.some((f) => f.id === lineId)) return prev;
        return [
          ...prev,
          {
            id: lineId,
            color: compiled.colors[compiled.colorIdx[i]],
            geom: {
              flat: compiled.pts[i],
              cum: compiled.cum[i],
              total: compiled.total[i],
              ang: compiled.ang[i],
            },
          },
        ];
      });
    },
    [compiled],
  );

  const endFlight = useCallback((lineId, escaped) => {
    if (escaped) escapedRef.current.add(lineId);
    setFlights((prev) => prev.filter((f) => f.id !== lineId));
  }, []);

  // -------------------------------------------------------------------------
  // Tap. e.x / e.y now arrive in SCREEN space, because the view is no longer
  // the size of the world. Invert the camera to get back to world space.
  // -------------------------------------------------------------------------
  const tapGesture = Gesture.Tap().onEnd((e) => {
    "worklet";

    const grid = LINE_TRIGGERS.value;
    if (!grid) return;

    const s = scale.value;
    const worldX = (e.x - tx.value) / s;
    const worldY = (e.y - ty.value) / s;

    // Hitbox is a fixed size on screen, so it grows in world units as you
    // zoom out — the same behaviour the old `half / scale` gave you.
    const half = HITBOX / 2 / s;

    const left = worldX - half;
    const top = worldY - half;
    const right = worldX + half;
    const bottom = worldY + half;

    const startCol = Math.max(
      0,
      Math.floor((left - GRID_OFFSET_X) / DOT_SPACING),
    );
    const endCol = Math.min(
      GRID_COLS - 1,
      Math.floor((right - GRID_OFFSET_X) / DOT_SPACING),
    );
    const startRow = Math.max(
      0,
      Math.floor((top - GRID_OFFSET_Y) / DOT_SPACING),
    );
    const endRow = Math.min(
      GRID_ROWS - 1,
      Math.floor((bottom - GRID_OFFSET_Y) / DOT_SPACING),
    );

    let foundLineId = null;

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const dotX = GRID_OFFSET_X + c * DOT_SPACING;
        const dotY = GRID_OFFSET_Y + r * DOT_SPACING;

        if (dotX >= left && dotX <= right && dotY >= top && dotY <= bottom) {
          const lineId = grid[r][c];
          if (lineId) {
            onTap.value++;
            foundLineId = lineId;
            if (isThrough(lineId)) {
              clearId(lineId);
              runOnJS(startFlight)(lineId);
              return;
            }
          }
          if (r === endRow && c === endCol && foundLineId) {
            runOnJS(startFlight)(foundLineId);
          }
        }
      }
    }
  });

  // A drag must not also register as a tap, so Tap races the other two.
  const gesture = Gesture.Race(
    tapGesture,
    Gesture.Simultaneous(panGesture, pinchGesture),
  );

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  const restingTiles = useMemo(() => {
    const flying = new Set(flights.map((f) => f.id));
    return recordRestingTiles(compiled, flying, escapedRef.current);
  }, [compiled, flights]);

  const gridPicture = useMemo(() => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(
      Skia.XYWHRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT),
    );
    const paint = Skia.Paint();
    paint.setAntiAlias(true);

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        paint.setColor(
          Skia.Color(photoGridColors?.[r]?.[c] ?? DEFAULT_DOT_COLOR),
        );
        canvas.drawCircle(
          GRID_OFFSET_X + c * DOT_SPACING,
          GRID_OFFSET_Y + r * DOT_SPACING,
          DOT_RADIUS,
          paint,
        );
      }
    }
    return recorder.finishRecordingAsPicture();
  }, [photoGridColors]);

  const cameraTransform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={gesture}>
        <View style={styles.viewport} onLayout={onLayout}>
          <Canvas style={StyleSheet.absoluteFillObject}>
            <Group transform={cameraTransform}>
              {/*               <Picture picture={gridPicture} /> */}
              {restingTiles.map((t) => (
                <Picture key={t.key} picture={t.picture} />
              ))}
              {flights.map((f) => (
                <FlightLine
                  key={f.id}
                  id={f.id}
                  geom={f.geom}
                  color={f.color}
                  onDone={endFlight}
                />
              ))}
            </Group>
          </Canvas>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    marginTop: 90,
    backgroundColor: "#f5f5f5",
  },
});
