import { View, StyleSheet } from "react-native";
import { ResumableZoom } from "react-native-zoom-toolkit";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { useSharedValue, useFrameCallback } from "react-native-reanimated";
import { Canvas, Picture, Skia } from "@shopify/react-native-skia";
import { useMemo, useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";

import { LINES as STATIC_LINES } from "../../utils/LINE_TRIGGER";
import { getGridColors, getGeneratedLines } from "../../utils/gridImageStore";
import BatchedLines from "../../components/BatchedLines";
import {
  compileLines,
  canvasToCell,
  pointAtLength,
} from "../../utils/lineBatch";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_DOT_COLOR,
  DOT_RADIUS,
  DOT_SPACING,
  FORWARD_RATE,
  GRID_COLS,
  GRID_OFFSET_X,
  GRID_OFFSET_Y,
  GRID_ROWS,
  HITBOX,
  MAX_PROGRESS,
  RETURN_MS,
  SPEED,
} from "../../utils/gridConfig";
import {
  COMPILED,
  LINE_DOTS_MAP,
  LINE_ESCAPED,
  LINE_IDLE,
  LINE_MOVING,
  LINE_RETURNING,
  LINE_TRIGGERS,
  activeList,
  frameTick,
  lineState,
  onTap,
  progress,
  returnRate,
  staticEpoch,
} from "../../utils/gameShared";

// ---------------------------------------------------------------------------
// Puzzle loading
// ---------------------------------------------------------------------------

function expandSegments(points) {
  const allDots = [];

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

  for (const line of lines) {
    for (const { row, col } of expandSegments(line.points)) {
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

function getActiveLinesSnapshot() {
  return getGeneratedLines() ?? STATIC_LINES;
}

/**
 * Swap in a whole new puzzle. Every shared value below is set with a
 * TOP-LEVEL assignment, which is the only form that synchronises the JS and
 * UI copies — same reasoning as the original buildTriggerGrid comment, now
 * applied to the animation arrays too.
 *
 * After this returns, the UI thread owns progress/lineState/returnRate/
 * activeList outright: JS never touches their contents again until the next
 * load, so per-frame mutation costs nothing.
 */
function loadPuzzle(lines) {
  const compiled = compileLines(lines);

  LINE_TRIGGERS.value = buildTriggerGrid(lines);
  LINE_DOTS_MAP.value = buildLineDotsMap(lines);
  COMPILED.value = compiled;

  progress.value = new Array(compiled.count).fill(0);
  lineState.value = new Array(compiled.count).fill(LINE_IDLE);
  returnRate.value = new Array(compiled.count).fill(0);
  activeList.value = [];

  onTap.value = 0;
  staticEpoch.value = staticEpoch.value + 1;
  frameTick.value = frameTick.value + 1;

  return compiled;
}

// Load once at module scope, exactly as the old LINE_TRIGGERS/LINE_DOTS_MAP
// makeMutable calls did — the store can already hold a photo-generated puzzle
// before this screen first renders.
const INITIAL_LINES = getActiveLinesSnapshot();
const INITIAL_COMPILED = loadPuzzle(INITIAL_LINES);

// ---------------------------------------------------------------------------
// Escape logic (unchanged, just reading from gameShared now)
// ---------------------------------------------------------------------------

function getDirection(dots) {
  "worklet";
  const last = dots[dots.length - 1];
  const prev = dots[dots.length - 2];
  return { dRow: last.row - prev.row, dCol: last.col - prev.col };
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

/**
 * Launch one line. Replaces the old dance of bumping `onTap` and having 875
 * useAnimatedReaction hooks each wake up to check `activeLineId.value === id`.
 * Now the tap just writes the two array slots that matter and pushes the
 * index onto the active list.
 */
function launchLine(lineId) {
  "worklet";
  const C = COMPILED.value;
  if (!C) return;

  const i = C.indexById[lineId];
  if (i === undefined) return;

  const st = lineState.value;
  if (st[i] !== LINE_IDLE) return; // already flying, bouncing, or gone

  st[i] = LINE_MOVING;
  progress.value[i] = 0;
  activeList.value.push(i);

  // It just left the resting layer, so that layer needs a rebuild.
  staticEpoch.value = staticEpoch.value + 1;
}

// ---------------------------------------------------------------------------

export default function AnimatedDashedLines() {
  const { restart, photoReady } = useLocalSearchParams();

  const [photoGridColors, setPhotoGridColors] = useState(() => getGridColors());
  const [compiled, setCompiled] = useState(INITIAL_COMPILED);

  // Restart rebuilds from whatever lines are CURRENTLY loaded, so it has to
  // track them independently of render — same reason the old code kept an
  // activeLinesRef.
  const activeLinesRef = useRef(INITIAL_LINES);

  useEffect(() => {
    if (!photoReady) return;

    setPhotoGridColors(getGridColors());

    const newLines = getGeneratedLines();
    if (!newLines) return;

    console.log("🖼️ New photo-generated lines loaded:", newLines.length);
    activeLinesRef.current = newLines;
    setCompiled(loadPuzzle(newLines));
  }, [photoReady]);

  useEffect(() => {
    if (!restart) return;
    console.log("🔄 Full Game Reset Triggered!");
    setCompiled(loadPuzzle(activeLinesRef.current));
  }, [restart]);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const onUpdate = ({ scale: s, translateX: tx, translateY: ty }) => {
    "worklet";
    scale.value = s;
    translateX.value = tx;
    translateY.value = ty;
  };

  // -------------------------------------------------------------------------
  // The single animation driver.
  //
  // This replaces every per-line withTiming + useAnimatedReaction +
  // useDerivedValue collision check. One callback, walking only the arrows
  // that are actually in flight. When activeList empties it early-returns
  // without touching frameTick, so an idle board triggers zero path rebuilds.
  // -------------------------------------------------------------------------
  useFrameCallback((frameInfo) => {
    "worklet";
    const dt = frameInfo.timeSincePreviousFrame;
    if (dt == null) return;

    const act = activeList.value;
    if (!act || act.length === 0) return;

    const C = COMPILED.value;
    const grid = LINE_TRIGGERS.value;
    if (!C || !grid) return;

    const prog = progress.value;
    const st = lineState.value;
    const rate = returnRate.value;

    const scratchPt = { x: 0, y: 0 };
    const scratchCell = { row: 0, col: 0 };

    let restingChanged = false;

    // Reverse iteration so splicing finished arrows out doesn't skip entries.
    for (let k = act.length - 1; k >= 0; k--) {
      const i = act[k];

      if (st[i] === LINE_MOVING) {
        prog[i] += dt * FORWARD_RATE;

        // Collision: where is the arrowhead, and does that cell belong to
        // someone else? Same check the old per-line useDerivedValue did.
        const headLen = prog[i] * SPEED + C.total[i];
        const h = pointAtLength(
          C.pts[i],
          C.cum[i],
          C.total[i],
          C.ang[i],
          headLen,
          scratchPt,
        );
        canvasToCell(h.x, h.y, scratchCell);

        let hit = null;
        if (
          scratchCell.row >= 0 &&
          scratchCell.row < grid.length &&
          scratchCell.col >= 0 &&
          scratchCell.col < grid[0].length
        ) {
          hit = grid[scratchCell.row][scratchCell.col];
        }

        if (hit && hit !== C.ids[i]) {
          // Blocked. Bounce back over RETURN_MS from wherever we got to.
          st[i] = LINE_RETURNING;
          rate[i] = prog[i] / RETURN_MS;
        } else if (prog[i] >= MAX_PROGRESS) {
          prog[i] = MAX_PROGRESS;
          st[i] = LINE_ESCAPED;
          act.splice(k, 1);
          restingChanged = true;
        }
      } else if (st[i] === LINE_RETURNING) {
        prog[i] -= dt * rate[i];
        if (prog[i] <= 0) {
          prog[i] = 0;
          st[i] = LINE_IDLE;
          act.splice(k, 1);
          restingChanged = true;
        }
      } else {
        act.splice(k, 1);
        restingChanged = true;
      }
    }

    if (restingChanged) staticEpoch.value = staticEpoch.value + 1;

    // One bump per frame drives every active-layer path rebuild at once.
    frameTick.value = frameTick.value + 1;
  });

  const tapGesture = Gesture.Tap().onEnd((e) => {
    "worklet";

    const grid = LINE_TRIGGERS.value;
    if (!grid) return;

    const canvasX = e.x;
    const canvasY = e.y;

    const half = HITBOX / 2;

    const topLeftX = canvasX - half / scale.value;
    const topLeftY = canvasY - half / scale.value;
    const bottomRightX = canvasX + half / scale.value;
    const bottomRightY = canvasY + half / scale.value;

    const startCol = Math.max(
      0,
      Math.floor((topLeftX - GRID_OFFSET_X) / DOT_SPACING),
    );
    const endCol = Math.min(
      GRID_COLS - 1,
      Math.floor((bottomRightX - GRID_OFFSET_X) / DOT_SPACING),
    );
    const startRow = Math.max(
      0,
      Math.floor((topLeftY - GRID_OFFSET_Y) / DOT_SPACING),
    );
    const endRow = Math.min(
      GRID_ROWS - 1,
      Math.floor((bottomRightY - GRID_OFFSET_Y) / DOT_SPACING),
    );

    let foundLineId = null;

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const dotX = GRID_OFFSET_X + c * DOT_SPACING;
        const dotY = GRID_OFFSET_Y + r * DOT_SPACING;

        if (
          dotX >= topLeftX &&
          dotX <= bottomRightX &&
          dotY >= topLeftY &&
          dotY <= bottomRightY
        ) {
          const lineId = grid[r][c];
          if (lineId) {
            onTap.value++;
            foundLineId = lineId;
            if (isThrough(lineId)) {
              clearId(lineId);
              launchLine(lineId);
              return;
            }
          }
          if (r === endRow && c === endCol && foundLineId) {
            // Blocked line: still launch it so it visibly bumps and returns.
            launchLine(foundLineId);
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

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const x = GRID_OFFSET_X + c * DOT_SPACING;
        const y = GRID_OFFSET_Y + r * DOT_SPACING;
        const cellColor = photoGridColors?.[r]?.[c] ?? DEFAULT_DOT_COLOR;
        paint.setColor(Skia.Color(cellColor));
        canvas.drawCircle(x, y, DOT_RADIUS, paint);
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
              <BatchedLines compiled={compiled} />
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
    width: 900,
    height: 900,
    marginTop: 70,
  },
});