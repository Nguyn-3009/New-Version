import { View, StyleSheet, Dimensions } from "react-native";
import { ResumableZoom } from "react-native-zoom-toolkit";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { useSharedValue, makeMutable } from "react-native-reanimated";
import { Canvas, Picture, Skia } from "@shopify/react-native-skia";
import { LINES } from "../utils/LINE_TRIGGER";
import SkiaLine from "../components/SkiaLine";
import { useMemo, useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { getGridColors } from "../utils/gridImageStore";

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

// Build triggers map from the data.
// This is a shared value (not a plain array) because it's read/written from
// both worklets (UI thread: isThrough, clearId, the tap gesture) and plain JS
// (restart reset in the effect below).
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
function buildTriggerGrid() {
  const grid = Array.from({ length: GRID_ROWS }, () =>
    Array(GRID_COLS).fill(null),
  );

  for (const line of LINES) {
    const dots = expandSegments(line.points);
    for (const { row, col } of dots) {
      grid[row][col] = line.id;
    }
  }

  return grid;
}

export const LINE_TRIGGERS = makeMutable(buildTriggerGrid());

// Build line dots map for quick access when rendering
const LINE_DOTS_MAP = LINES.reduce((acc, line) => {
  acc[line.id] = expandSegments(line.points);
  return acc;
}, {});

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

  const dots = LINE_DOTS_MAP[lineId];

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
  const dots = LINE_DOTS_MAP[lineId];

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

  useEffect(() => {
    if (photoReady) {
      setPhotoGridColors(getGridColors());
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
      // why nested mutation doesn't sync across threads here.
      LINE_TRIGGERS.value = buildTriggerGrid();

      // Tell every SkiaLine to reset its own in-flight progress/isMoving state
      resetSignal.value = resetSignal.value + 1;

      // You can add more resets here if needed
    }
  }, [restart]); // ← This is the key: runs

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const activeLineId = useSharedValue(null);

  const onTransform = ({ scale: s, translateX: tx, translateY: ty }) => {
    scale.value = s;
    translateX.value = tx;
    translateY.value = ty;
  };

  const tapGesture = Gesture.Tap().onEnd((e) => {
    "worklet";

    const x = e.x;
    const y = e.y;

    const half = HITBOX / 2;

    const canvasX = (x - translateX.value) / scale.value;
    const canvasY = (y - translateY.value) / scale.value;

    const topLeftX = canvasX - half / scale.value;
    const topLeftY = canvasY - half / scale.value;

    const bottomRightX = canvasX + half / scale.value;
    const bottomRightY = canvasY + half / scale.value;

    const offsetX = 40;
    const offsetY = 40;

    const startCol = Math.floor((topLeftX - offsetX) / DOT_SPACING);
    const endCol = Math.floor((bottomRightX - offsetX) / DOT_SPACING);

    const startRow = Math.floor((topLeftY - offsetY) / DOT_SPACING);
    const endRow = Math.floor((bottomRightY - offsetY) / DOT_SPACING);

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

    const radius = 5;

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
        onTransform={onTransform}
      >
        <GestureDetector gesture={tapGesture}>
          <View style={styles.contentContainer}>
            <Canvas style={StyleSheet.absoluteFillObject}>
              <Picture picture={gridPicture} />

              {LINES.map((line) => (
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
  },
});
