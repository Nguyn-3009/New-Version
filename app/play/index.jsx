import { View, StyleSheet, Dimensions } from "react-native";
import { ResumableZoom } from "react-native-zoom-toolkit";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { useSharedValue, makeMutable } from "react-native-reanimated";
import { Canvas, Picture, Skia } from "@shopify/react-native-skia";
import { LINES as STATIC_LINES } from "../utils/LINE_TRIGGER";
import SkiaLine from "../components/SkiaLine";
import { useMemo, useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { getGridColors, getGeneratedLines } from "../utils/gridImageStore";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const CANVAS_WIDTH = 2500;
const CANVAS_HEIGHT = 2500;

const GRID_ROWS = Math.ceil(CANVAS_HEIGHT / 20); // 125
const GRID_COLS = Math.ceil(CANVAS_WIDTH / 20); // 125

const DOT_SPACING = 20;
const HITBOX = 48;

// Module-scope shared state must use makeMutable, not the useSharedValue hook
// (hooks can only be called during a component's render).
export const onTap = makeMutable(0);

// Bumped on every restart so each SkiaLine instance knows to reset its own
// in-flight animation progress (arrows that were mid-flight otherwise stay
// wherever they were, since SkiaLine components aren't remounted on restart).
export const resetSignal = makeMutable(0);

function expandSegments(points) {
  const allDots = [];

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];

    if (from.row === to.row) {
      // Horizontal
      const step = from.col < to.col ? 1 : -1;
      for (let c = from.col; ; c += step) {
        allDots.push({ row: from.row, col: c });
        if (c === to.col) break;
      }
    } else if (from.col === to.col) {
      // Vertical
      const step = from.row < to.row ? 1 : -1;
      for (let r = from.row; ; r += step) {
        allDots.push({ row: r, col: from.col });
        if (r === to.row) break;
      }
    } else {
      // Diagonal support (if you ever need it later)
      console.warn("Diagonal lines not supported yet");
    }
  }

  return allDots;
}

// Whichever lines are "active" right now: photo-generated ones if a photo's
// been processed this session (the store persists across navigation, so
// this can already be populated even before the component's first render),
// falling back to the static demo puzzle otherwise.
function getActiveLinesSnapshot() {
  return getGeneratedLines() ?? STATIC_LINES;
}

// Build triggers map from the data.
// This is a shared value (not a plain array) because it's read/written from
// both worklets (UI thread: isThrough, clearId, the tap gesture) and plain JS
// (restart/photo-load reset in the effects below).
//
// IMPORTANT: in Reanimated's new architecture (react-native-worklets), the
// JS-thread and UI-thread copies of a shared value are only synchronized via
// a *top-level* `.value = x` assignment. Deep/nested mutation like
// `LINE_TRIGGERS.value[row][col] = x` silently mutates only whichever
// thread's local copy you're on — it does NOT propagate across threads.
// So we build the fully-populated grid as a plain object FIRST, then hand
// the finished grid to makeMutable in one shot, instead of creating an empty
// mutable and mutating it afterward (which left the UI thread's copy
// permanently empty/null and made every tap a no-op).
function buildTriggerGrid(lines) {
  const grid = Array.from({ length: GRID_ROWS }, () =>
    Array(GRID_COLS).fill(null),
  );

  for (const line of lines) {
    const dots = expandSegments(line.points);
    for (const { row, col } of dots) {
      grid[row][col] = line.id;
    }
  }

  return grid;
}

function buildLineDotsMap(lines) {
  return lines.reduce((acc, line) => {
    acc[line.id] = expandSegments(line.points);
    return acc;
  }, {});
}

export const LINE_TRIGGERS = makeMutable(
  buildTriggerGrid(getActiveLinesSnapshot()),
);

// LINE_DOTS_MAP is read from isThrough/clearId (worklets, UI thread) just
// like LINE_TRIGGERS, and — same as LINE_TRIGGERS — needs to be swappable at
// runtime once a photo generates a brand new set of lines, so it needs the
// same makeMutable treatment rather than being a plain object.
export const LINE_DOTS_MAP = makeMutable(
  buildLineDotsMap(getActiveLinesSnapshot()),
);

function getDirection(dots) {
  "worklet";

  const last = dots[dots.length - 1];
  const prev = dots[dots.length - 2];

  return {
    dRow: last.row - prev.row,
    dCol: last.col - prev.col,
  };
}

function isThrough(lineId) {
  "worklet";

  const dots = LINE_DOTS_MAP.value[lineId];

  const last = dots[dots.length - 1];

  const { dRow, dCol } = getDirection(dots);

  let row = last.row + dRow;
  let col = last.col + dCol;

  while (row >= 0 && col >= 0 && row < GRID_ROWS && col < GRID_COLS) {
    const hit = LINE_TRIGGERS.value[row][col];

    // 🔥 hit another line
    if (hit && hit !== lineId) {
      return false;
    }

    row += dRow;
    col += dCol;
  }

  return true;
}

function clearId(lineId) {
  "worklet";
  const dots = LINE_DOTS_MAP.value[lineId];

  for (const { row, col } of dots) {
    LINE_TRIGGERS.value[row][col] = null;
  }
}

export default function AnimatedDashedLines() {
  const { restart, photoReady } = useLocalSearchParams();

  // A 125x125 color grid is far too large to pass through router params, so
  // the photo screen stashes it in a plain module store and just bumps
  // `photoReady` to tell us to go read it.
  const [photoGridColors, setPhotoGridColors] = useState(() => getGridColors());

  // Whichever LINES are currently playable — the static demo puzzle until a
  // photo's been processed, then whatever generateLinesData produced.
  const [activeLines, setActiveLines] = useState(getActiveLinesSnapshot);

  // Restart needs the LATEST active lines to rebuild from, but shouldn't
  // itself re-run just because activeLines changed (that's photoReady's
  // job, below) — a ref sidesteps the stale-closure problem without adding
  // activeLines to the restart effect's dependency array.
  const activeLinesRef = useRef(activeLines);
  useEffect(() => {
    activeLinesRef.current = activeLines;
  }, [activeLines]);

  useEffect(() => {
    if (photoReady) {
      setPhotoGridColors(getGridColors());

      const newLines = getGeneratedLines();
      if (newLines) {
        console.log("🖼️ New photo-generated lines loaded:", newLines.length);


        setActiveLines(newLines);

        // A whole new puzzle is basically a fresh game: rebuild the trigger
        // grids from the new lines and reset the same shared state restart
        // does. Same reasoning as buildTriggerGrid's comment above — build
        // fresh plain objects first, then assign wholesale.
        LINE_TRIGGERS.value = buildTriggerGrid(newLines);
        LINE_DOTS_MAP.value = buildLineDotsMap(newLines);
        onTap.value = 0;
        activeLineId.value = null;
        resetSignal.value = resetSignal.value + 1;
      }
    }
  }, [photoReady]);

  // This runs every time the screen is mounted OR when restart param changes
  useEffect(() => {
    if (restart) {
      console.log("🔄 Full Game Reset Triggered!");

      // Reset shared values from your main game file
      onTap.value = 0;
      activeLineId.value = null;

      // Restore all LINE_TRIGGERS (very important).
      // Assign a brand-new grid object wholesale rather than mutating the
      // existing one in place — see the comment above buildTriggerGrid for
      // why nested mutation doesn't sync across threads here. Rebuilds from
      // whatever lines are CURRENTLY active (the photo-generated puzzle, if
      // one's loaded) rather than always the static default.
      const lines = activeLinesRef.current;
      LINE_TRIGGERS.value = buildTriggerGrid(lines);
      LINE_DOTS_MAP.value = buildLineDotsMap(lines);

      // Tell every SkiaLine to reset its own in-flight progress/isMoving state
      resetSignal.value = resetSignal.value + 1;

      // You can add more resets here if needed
    }
  }, [restart]); // ← This is the key: runs

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const activeLineId = useSharedValue(null);

  // react-native-zoom-toolkit's ResumableZoom calls `onUpdate`, not
  // `onTransform` — the prop name used before doesn't exist on the
  // component, so this callback was silently never firing. scale/
  // translateX/translateY were stuck at their initial values (1, 0, 0) the
  // moment you panned or zoomed at all, which throws off tap-hit detection.
  const onUpdate = ({ scale: s, translateX: tx, translateY: ty }) => {
    "worklet";
    scale.value = s;
    translateX.value = tx;
    translateY.value = ty;
  };

  const tapGesture = Gesture.Tap().onEnd((e) => {
    "worklet";

    // e.x/e.y are already local to `contentContainer`, which sits INSIDE
    // ResumableZoom's transformed Animated.View. React Native Gesture
    // Handler's native hit-testing already accounts for that ancestor's
    // pan/zoom transform when computing local coordinates — so these are
    // already canvas-space coordinates. Manually subtracting translateX/Y
    // and dividing by scale again here was double-correcting: it happened
    // to cancel out to a no-op while translateX/translateY/scale were
    // (incorrectly) frozen at their defaults (0, 0, 1), which is why taps
    // "worked" before onUpdate was wired up — but once those values started
    // reflecting real pan/zoom state, this was over-correcting and sending
    // every tap to the wrong grid cell.
    const canvasX = e.x;
    const canvasY = e.y;

    const half = HITBOX / 2;

    // scale.value IS still needed here though: it converts a fixed physical
    // screen-pixel tap tolerance into the equivalent canvas-space tolerance,
    // so the *finger-sized* hit area stays consistent regardless of zoom
    // level (zoomed in, a screen-sized tap covers fewer canvas units).
    const topLeftX = canvasX - half / scale.value;
    const topLeftY = canvasY - half / scale.value;

    const bottomRightX = canvasX + half / scale.value;
    const bottomRightY = canvasY + half / scale.value;

    const offsetX = 40;
    const offsetY = 40;

    const rawStartCol = Math.floor((topLeftX - offsetX) / DOT_SPACING);
    const rawEndCol = Math.floor((bottomRightX - offsetX) / DOT_SPACING);

    const rawStartRow = Math.floor((topLeftY - offsetY) / DOT_SPACING);
    const rawEndRow = Math.floor((bottomRightY - offsetY) / DOT_SPACING);

    // Clamp to the grid. Without this, a tap near the edge of the grid can
    // push these past [0, GRID_COLS - 1] / [0, GRID_ROWS - 1], and
    // LINE_TRIGGERS.value[r] is undefined out there — indexing into
    // undefined[c] throws inside this worklet (UI thread), which crashes
    // the whole app instead of showing a JS error.
    const startCol = Math.max(0, rawStartCol);
    const endCol = Math.min(GRID_COLS - 1, rawEndCol);

    const startRow = Math.max(0, rawStartRow);
    const endRow = Math.min(GRID_ROWS - 1, rawEndRow);

    let foundLineId = null;
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const dotX = offsetX + c * DOT_SPACING;
        const dotY = offsetY + r * DOT_SPACING;

        if (
          dotX >= topLeftX &&
          dotX <= bottomRightX &&
          dotY >= topLeftY &&
          dotY <= bottomRightY
        ) {
          const lineId = LINE_TRIGGERS.value[r][c];
          if (lineId) {
            onTap.value++;
            foundLineId = lineId;
            console.log("Tapped lineId:", lineId);
            if (isThrough(lineId)) {
              console.log("Line is through, clearing lineId:", lineId);
              clearId(lineId);
              onTap.value++;
              activeLineId.value = foundLineId;
              break;
            }
          }
          if (r === endRow && c === endCol) {
            onTap.value++;
            activeLineId.value = foundLineId;
          }
        }
      }
    }
  });

  const gridPicture = useMemo(() => {
    const recorder = Skia.PictureRecorder();

    const canvas = recorder.beginRecording(
      Skia.XYWHRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT),
    );

    const paint = Skia.Paint();

    const radius = 10;

    const cols = Math.ceil(CANVAS_WIDTH / DOT_SPACING);
    const rows = Math.ceil(CANVAS_HEIGHT / DOT_SPACING);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 40 + c * DOT_SPACING;
        const y = 40 + r * DOT_SPACING;

        // Milestone 1: color each dot from the photo's mapped grid when one
        // has been loaded, otherwise fall back to the default dot color.
        const cellColor = photoGridColors?.[r]?.[c] ?? "#766e6e";
        paint.setColor(Skia.Color(cellColor));

        canvas.drawCircle(x, y, radius, paint);
      }
    }

    return recorder.finishRecordingAsPicture();
  }, [photoGridColors]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ResumableZoom
        style={styles.mapContainer}
        maxScale={5}
        minScale={1}
        onUpdate={onUpdate}
      >
        <GestureDetector gesture={tapGesture}>
          <View style={styles.contentContainer}>
            <Canvas style={StyleSheet.absoluteFillObject}>
              <Picture picture={gridPicture} />

              {activeLines.map((line) => (
                <SkiaLine
                  key={line.id}
                  id={line.id}
                  activeLineId={activeLineId}
                  color={line.color}
                  points={line.points}
                />
              ))}
            </Canvas>
          </View>
        </GestureDetector>
      </ResumableZoom>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  mapContainer: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  contentContainer: {
    width: CANVAS_WIDTH + 2 * 40,
    height: CANVAS_HEIGHT + 2 * 40,
    marginTop: 70,
  },
});
