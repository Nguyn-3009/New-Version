import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import {
  runOnJS,
  runOnUI,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { Canvas, Group, Picture, Skia } from "@shopify/react-native-skia";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { LINES as STATIC_LINES } from "../../utils/LINE_TRIGGER";
import {
  getGridColors,
  getGeneratedLines,
  getPuzzleMeta,
  getPuzzleVersion,
} from "../../utils/gridImageStore";
import { markCleared } from "../../utils/levelProgress";
import { livesFor } from "../../utils/gameRules";
import FlightSlot from "../../components/FlightSlot";
import { compileLines } from "../../utils/lineBatch";
import {
  buildTileIndex,
  recordAllTiles,
  recordOneTile,
} from "../../utils/restingTiles";
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
import {
  FLIGHT_GEOM,
  POOL_SIZE,
  buildFlightGeom,
  launchFlight,
  resetPool,
} from "../../utils/flightPool";

// Stable slot indices for the flight pool. Module scope so the array identity
// never changes and the pool never remounts.
const POOL_SLOTS = Array.from({ length: POOL_SIZE }, (_, i) => i);

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

  const compiled = compileLines(lines);
  // Geometry the UI thread needs to fly an arrow without a React round trip.
  // Assigned HERE, alongside the other three, so a puzzle load stays ONE batch
  // of top-level shared-value writes rather than growing a second one later.
  FLIGHT_GEOM.value = buildFlightGeom(compiled);
  return compiled;
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
  const router = useRouter();

  // After solving, a level sends you onward; a photo or daily just goes home.
  const meta = getPuzzleMeta();
  const nextTarget = meta?.source === "level" ? "/levels" : "/";
  const nextLabel = meta?.source === "level" ? "Next level" : "Done";

  const [photoGridColors, setPhotoGridColors] = useState(() => getGridColors());
  const [compiled, setCompiled] = useState(() =>
    loadPuzzle(getActiveLinesSnapshot()),
  );
  // Which lines are airborne. A ref, not state: nothing about the render tree
  // depends on it any more, and the whole point is to stop committing.
  const flyingRef = useRef(new Set());

  const tileIndex = useMemo(() => buildTileIndex(compiled), [compiled]);

  // Tiles are kept as STATE and patched in place. Re-recording all 25 on every
  // flight change cost ~42 ms per launch AND per landing - so tapping a few
  // arrows queued dozens of full rebuilds back to back. But launching one line
  // only changes the tiles that line touches; the other ~23 are identical.
  const [tiles, setTiles] = useState([]);
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
    flyingRef.current = new Set();
    runOnUI(resetPool)();
    setSolved(false);
    setLives(livesFor(getPuzzleMeta()));
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

  // Re-record only the tiles a given line touches. Same work recordOneTile
  // always did - it just no longer waits on a flights-array diff to discover
  // which line changed, because the caller already knows.
  const repaintTilesFor = useCallback(
    (lineId) => {
      const i = compiled.indexById[lineId];
      if (i === undefined) return;
      const dirty = tileIndex.lineTiles[i];
      if (!dirty || dirty.length === 0) return;

      setTiles((prevTiles) => {
        const byKey = new Map(prevTiles.map((t) => [t.key, t]));
        for (const t of dirty) {
          const rebuilt = recordOneTile(
            compiled,
            t,
            tileIndex,
            flyingRef.current,
            escapedRef.current,
          );
          if (rebuilt) byKey.set(t, rebuilt);
          else byKey.delete(t);
        }
        return [...byKey.values()];
      });
    },
    [compiled, tileIndex],
  );

  // Called from the UI thread once a slot has actually been claimed, so the
  // resting board can drop the arrow that is now airborne. This is the only
  // React commit a launch still costs.
  const notifyLaunch = useCallback(
    (lineId) => {
      flyingRef.current.add(lineId);
      repaintTilesFor(lineId);
    },
    [repaintTilesFor],
  );

  // The board is solved when every arrow has escaped. Until now the game had
  // no win state at all - which is fine for a photo you play until bored, but
  // levels cannot advance without one.
  const [solved, setSolved] = useState(false);

  // Lives are spent on COLLISIONS, not taps. An arrow that bounces is the game
  // saying your read was wrong; an arrow that escapes cleanly costs nothing.
  const maxLives = livesFor(meta);
  const [lives, setLives] = useState(maxLives);
  const dead = lives <= 0;

  // Called from the UI thread when a flight finishes, escaped or bounced. The
  // game logic below is unchanged; only the bookkeeping around it moved off
  // React state. setLives and setTiles land in the SAME commit thanks to
  // React's auto-batching, so a landing costs one commit, not two.
  const notifyDone = useCallback(
    (lineId, escaped) => {
      if (!flyingRef.current.delete(lineId)) return;

      if (escaped) {
        escapedRef.current.add(lineId);
        if (escapedRef.current.size >= compiled.count) {
          setSolved(true);
          const m = getPuzzleMeta();
          if (m?.source === "level") markCleared(m.level);
        }
      } else {
        // Bounced: blocked by another arrow.
        setLives((l) => Math.max(0, l - 1));
      }

      repaintTilesFor(lineId);
    },
    [compiled, repaintTilesFor],
  );

  // Claim a slot and start the arrow moving, entirely on the UI thread. The
  // only JS hop is notifyLaunch, and only once the launch actually happened.
  const launch = useCallback(
    (lineId) => {
      "worklet";
      const g = FLIGHT_GEOM.value;
      if (!g) return;
      const i = g.indexById[lineId];
      if (i === undefined) return;
      if (launchFlight(i, notifyDone) < 0) return;
      runOnJS(notifyLaunch)(lineId);
    },
    [notifyDone, notifyLaunch],
  );

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
              launch(lineId);
              return;
            }
          }
          if (r === endRow && c === endCol && foundLineId) {
            launch(foundLineId);
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

  useEffect(() => {
    setTiles(
      recordAllTiles(compiled, tileIndex, flyingRef.current, escapedRef.current),
    );
    // Full rebuild only when the puzzle itself changes.
  }, [compiled, tileIndex]);

  // The per-flight dirty-tile patching that used to live here is now driven
  // directly by notifyLaunch / notifyDone. It ran off a diff of the `flights`
  // state, which meant a launch cost two commits: one to add the flight, one
  // to patch the tiles. The caller already knows which line changed, so the
  // diff - and the extra commit - were both avoidable.

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
              {tiles.map((t) => (
                <Picture key={t.key} picture={t.picture} />
              ))}
              {/* Fixed-size pool. These mount once and never unmount, so no
                  launch or landing changes the shape of this tree. */}
              {POOL_SLOTS.map((i) => (
                <FlightSlot key={i} index={i} onDone={notifyDone} />
              ))}
            </Group>
          </Canvas>
        </View>
      </GestureDetector>

      <View style={styles.hud} pointerEvents="none">
        <Text style={styles.hearts}>
          {"\u2665 ".repeat(lives).trim()}
          {lives < maxLives ? (
            <Text style={styles.heartsLost}>
              {" " + "\u2665 ".repeat(maxLives - lives).trim()}
            </Text>
          ) : null}
        </Text>
      </View>

      {/* Game over. pointerEvents defaults to "auto" here, unlike the solved
          overlay - a dead board must stop accepting taps, and covering it is
          simpler and more reliable than gating the tap worklet on a shared
          value. */}
      {dead && !solved && (
        <View style={styles.deadOverlay}>
          <View style={styles.solvedCard}>
            <Text style={styles.solvedTitle}>Out of lives</Text>
            <Text style={styles.solvedSub}>
              {maxLives} collisions — every arrow has to escape cleanly
            </Text>
            <Pressable
              onPress={() => reload(activeLinesRef.current)}
              style={({ pressed }) => [
                styles.solvedBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.solvedBtnLabel}>Try again</Text>
            </Pressable>
            <Pressable
              onPress={() => router.replace(nextTarget)}
              style={({ pressed }) => [
                styles.deadGhost,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.deadGhostLabel}>
                {meta?.source === "level" ? "Back to levels" : "Back"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {solved && (
        <View style={styles.solvedOverlay} pointerEvents="box-none">
          <View style={styles.solvedCard}>
            <Text style={styles.solvedTitle}>Solved</Text>
            <Text style={styles.solvedSub}>Every arrow escaped</Text>
            <Pressable
              onPress={() => router.replace(nextTarget)}
              style={({ pressed }) => [
                styles.solvedBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.solvedBtnLabel}>{nextLabel}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  hud: {
    position: "absolute",
    top: 78,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  hearts: { fontSize: 22, color: "#E24B4A", letterSpacing: 2 },
  heartsLost: { color: "#d8d5ce" },
  deadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(245,245,245,0.82)",
    alignItems: "center",
    justifyContent: "center",
  },
  deadGhost: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 20 },
  deadGhostLabel: { color: "#888", fontSize: 14, fontWeight: "600" },
  solvedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 60,
  },
  solvedCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  solvedTitle: { fontSize: 26, fontWeight: "800", color: "#222" },
  solvedSub: { fontSize: 13, color: "#888", marginTop: 2, marginBottom: 16 },
  solvedBtn: {
    backgroundColor: "#E24B4A",
    paddingVertical: 13,
    paddingHorizontal: 34,
    borderRadius: 12,
  },
  solvedBtnLabel: { color: "#fff", fontSize: 16, fontWeight: "700" },
  viewport: {
    flex: 1,
    marginTop: 90,
    backgroundColor: "#f5f5f5",
  },
});
