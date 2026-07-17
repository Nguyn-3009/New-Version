import React, { useMemo } from "react";
import { Path, Skia, Group, point } from "@shopify/react-native-skia";
import { LINE_TRIGGERS, onTap, resetSignal } from "../play/index";
import {
  useSharedValue,
  useAnimatedReaction,
  useDerivedValue,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";

const DOT_SPACING = 20;
const GRID_OFFSET = { x: 40, y: 40 };
const SPEED = 80;

const toCanvas = (row, col) => ({
  x: GRID_OFFSET.x + col * DOT_SPACING,
  y: GRID_OFFSET.y + row * DOT_SPACING,
});

// 🔥 distance between points
const dist = (a, b) => {
  "worklet";
  return Math.hypot(b.x - a.x, b.y - a.y);
};

// 🔥 total path length
const getTotalLength = (points) => {
  "worklet";
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += dist(points[i], points[i + 1]);
  }
  return len;
};

// 🔥 get point at absolute length
const getPointAtLength = (points, targetLen, totalLength, angle) => {
  "worklet";

  // 🔥 overshoot → extend last segment infinitely
  const last = points[points.length - 1];

  const extra = targetLen - totalLength;

  return {
    x: last.x + Math.cos(angle) * extra,
    y: last.y + Math.sin(angle) * extra,
  };
};

function findOrder(arr, target, points) {
  "worklet";

  let startIdx = 0;
  let tail = points[0];
  let right = arr.length;

  if (arr.length === 0) return { startIdx: -1, tail };

  // out-of-bound check
  if (target < arr[0] || target > arr[arr.length - 1]) {
    return { startIdx: -1, tail };
  }

  while (startIdx < right) {
    const mid = Math.floor((startIdx + right) / 2);

    if (arr[mid] < target) {
      startIdx = mid + 1;
    } else {
      right = mid;
    }
  }

  if (startIdx === 0) return { startIdx: 0, tail: points[0] };

  let local_segment_travel = target - arr[startIdx - 1];

  if (points[startIdx].x === points[startIdx - 1].x) {
    if (points[startIdx].y > points[startIdx - 1].y) {
      tail = {
        x: points[startIdx - 1].x,
        y: points[startIdx - 1].y + local_segment_travel,
      };
    } else {
      tail = {
        x: points[startIdx - 1].x,
        y: points[startIdx - 1].y - local_segment_travel,
      };
    }
  } else {
    if (points[startIdx].x > points[startIdx - 1].x) {
      tail = {
        x: points[startIdx - 1].x + local_segment_travel,
        y: points[startIdx - 1].y,
      };
    } else {
      tail = {
        x: points[startIdx - 1].x - local_segment_travel,
        y: points[startIdx - 1].y,
      };
    }
  }

  return { startIdx, tail };
}

export default function SkiaLine({
  id,
  points = [],
  activeLineId,
  color = "blue",
  strokeWidth = 3,
  duration = 1500,
}) {
  const canvasPoints = useMemo(
    () => points.map((p) => toCanvas(p.row, p.col)),
    [points],
  );

  const path = useMemo(() => {
    const p = Skia.Path.Make();
    canvasPoints.forEach((pt, i) => {
      if (i === 0) p.moveTo(pt.x, pt.y);
      else p.lineTo(pt.x, pt.y);
    });
    return p;
  }, [canvasPoints]);

  const angle = useMemo(() => {
    if (canvasPoints.length < 2) return 0;
    const p1 = canvasPoints[canvasPoints.length - 2];
    const p2 = canvasPoints[canvasPoints.length - 1];
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
  }, [canvasPoints]);

  const lengthRange = useMemo(() => {
    let range = [0];
    let len = 0;

    for (let i = 1; i < canvasPoints.length; i++) {
      const segLen = dist(canvasPoints[i - 1], canvasPoints[i]);
      len += segLen;
      range.push(len);
    }

    return range;
  }, [canvasPoints]);

  const totalLength = useMemo(
    () => getTotalLength(canvasPoints),
    [canvasPoints],
  );

  const progress = useSharedValue(0);
  const isMoving = useSharedValue(false);

  // Reset this arrow's own animation state on restart. Since SkiaLine
  // components aren't remounted on restart (same key, same list), progress/
  // isMoving would otherwise keep whatever value they had before the restart.
  useAnimatedReaction(
    () => resetSignal.value,
    (curr, prev) => {
      if (prev !== null && curr !== prev) {
        progress.value = 0;
        isMoving.value = false;
      }
    },
  );

  // Moving forward
  useAnimatedReaction(
    () => onTap.value,
    () => {
      if (activeLineId.value === id && !isMoving.value) {
        isMoving.value = true;

        progress.value = withTiming(
          10,
          {
            duration: 1000,
            easing: Easing.linear,
          },
          (finished) => {
            if (finished) isMoving.value = false;
          },
        );
      }
    },
  );

  const derived = useDerivedValue(() => {
    const headLen = progress.value * SPEED + totalLength;
    const tailLen = headLen - totalLength;

    const head = getPointAtLength(canvasPoints, headLen, totalLength, angle);

    let row = Math.round((head.y - GRID_OFFSET.y) / DOT_SPACING);
    let col = Math.round((head.x - GRID_OFFSET.x) / DOT_SPACING);

    let hit = null;

    if (
      row >= 0 &&
      row < LINE_TRIGGERS.value.length &&
      col >= 0 &&
      col < LINE_TRIGGERS.value[0].length
    ) {
      hit = LINE_TRIGGERS.value[row][col];
    }

    if (hit && hit !== id && isMoving.value) {
      progress.value = withTiming(
        0,
        {
          duration: 500,
          easing: Easing.linear,
        },
        (finished) => {
          if (finished) isMoving.value = false;
        },
      );
    }

    return { head, headLen, tailLen };
  });

  const bodyPath = useDerivedValue(() => {
    const p = Skia.Path.Make();

    let start = Math.max(0, derived.value.tailLen);
    let end = derived.value.head;

    let { startIdx, tail } = findOrder(lengthRange, start, canvasPoints);
    if (startIdx === -1) {
      let tail_overbound = getPointAtLength(
        canvasPoints,
        start,
        totalLength,
        angle,
      );
      p.moveTo(tail_overbound.x, tail_overbound.y);
    } else {
      p.moveTo(tail.x, tail.y);
      for (let i = startIdx; i < canvasPoints.length - 1; i++) {
        p.lineTo(canvasPoints[i].x, canvasPoints[i].y);
      }
    }

    p.lineTo(end.x, end.y);

    return p;
  });

  const arrowTransform = useDerivedValue(() => {
    const { x, y } = derived.value.head;

    return [{ translateX: x }, { translateY: y }, { rotate: angle }];
  });

  return (
    <>
      {/* base path */}
      <Path
        path={path}
        color={color}
        style="stroke"
        strokeWidth={strokeWidth}
        opacity={0.2}
      />

      {/* 🔥 arrow body */}
      <Path
        path={bodyPath}
        color={color}
        style="stroke"
        strokeWidth={strokeWidth}
      />

      {/* 🔥 arrow head */}
      <Group transform={arrowTransform}>
        <Path
          path={Skia.Path.MakeFromSVGString("M0 -6 L12 0 L0 6 Z")}
          color={color}
        />
      </Group>
    </>
  );
}
