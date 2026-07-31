// Compiles generateLinesData() output into a flat, worklet-friendly form, and
// provides the geometry helpers used to stamp many arrows into a small number
// of Skia paths.
//
// Why compile at all: the old SkiaLine did all of this per line, per mount, in
// four separate useMemo hooks (canvasPoints, path, angle, lengthRange,
// totalLength). At 875 lines that's ~4,400 memoised allocations and 875
// component trees. Here it happens once, into plain arrays, and the result is
// handed to the UI thread in a single shared-value assignment.

import {
  ARROW_TRI,
  DOT_SPACING,
  GRID_OFFSET_X,
  GRID_OFFSET_Y,
  toCanvasX,
  toCanvasY,
} from "./gridConfig";

/**
 * @param {{id:string,color:string,points:{row:number,col:number}[]}[]} lines
 * @returns {{
 *   count: number,
 *   ids: string[],
 *   indexById: Record<string, number>,
 *   pts: number[][],      // per line: [x0,y0,x1,y1,...] canvas coords
 *   cum: number[][],      // per line: cumulative length at each vertex
 *   total: number[],      // per line: full polyline length
 *   ang: number[],        // per line: exit angle (radians) of the last segment
 *   colorIdx: number[],   // per line: index into `colors`
 *   colors: string[],     // unique colours, in first-seen order (== K)
 *   byColor: number[][],  // per colour: the line indices using it
 * }}
 */
export function compileLines(lines) {
  const count = lines.length;

  const ids = new Array(count);
  const indexById = {};
  const pts = new Array(count);
  const cum = new Array(count);
  const total = new Array(count);
  const ang = new Array(count);
  const colorIdx = new Array(count);

  const colors = [];
  const colorSlot = {};

  for (let i = 0; i < count; i++) {
    const line = lines[i];

    ids[i] = line.id;
    indexById[line.id] = i;

    if (colorSlot[line.color] === undefined) {
      colorSlot[line.color] = colors.length;
      colors.push(line.color);
    }
    colorIdx[i] = colorSlot[line.color];

    const p = line.points;
    const n = p.length;
    const flat = new Array(n * 2);
    const c = new Array(n);

    let len = 0;
    for (let j = 0; j < n; j++) {
      const x = toCanvasX(p[j].col);
      const y = toCanvasY(p[j].row);
      flat[j * 2] = x;
      flat[j * 2 + 1] = y;
      if (j > 0) {
        len += Math.hypot(x - flat[(j - 1) * 2], y - flat[(j - 1) * 2 + 1]);
      }
      c[j] = len;
    }

    pts[i] = flat;
    cum[i] = c;
    total[i] = len;

    // Exit direction: the heading of the final segment, which is the direction
    // the arrow flies once it runs off the end of its own polyline.
    ang[i] =
      n >= 2
        ? Math.atan2(
          flat[(n - 1) * 2 + 1] - flat[(n - 2) * 2 + 1],
          flat[(n - 1) * 2] - flat[(n - 2) * 2],
        )
        : 0;
  }

  const byColor = colors.map(() => []);
  for (let i = 0; i < count; i++) byColor[colorIdx[i]].push(i);

  return { count, ids, indexById, pts, cum, total, ang, colorIdx, colors, byColor };
}

// ---------------------------------------------------------------------------
// Worklet geometry
// ---------------------------------------------------------------------------

/**
 * Point at arc-length `t` along a compiled polyline. Past the end of the
 * polyline the last segment is extended indefinitely along `angle` — that's
 * the "arrow escapes off the board" behaviour from the old getPointAtLength.
 *
 * Replaces the old findOrder(), which assumed every segment was axis-aligned
 * and branched on x/y equality. This lerps instead, so it stays correct if you
 * ever let generateLines emit diagonals.
 */
export function pointAtLength(flat, cumArr, total, angle, t, out) {
  "worklet";
  const n = cumArr.length;

  if (t <= 0) {
    out.x = flat[0];
    out.y = flat[1];
    return out;
  }

  if (t >= total) {
    const extra = t - total;
    out.x = flat[(n - 1) * 2] + Math.cos(angle) * extra;
    out.y = flat[(n - 1) * 2 + 1] + Math.sin(angle) * extra;
    return out;
  }

  // Binary search for the first vertex at or past `t`.
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumArr[mid] < t) lo = mid + 1;
    else hi = mid;
  }

  const segStart = cumArr[lo - 1];
  const segLen = cumArr[lo] - segStart;
  const r = segLen === 0 ? 0 : (t - segStart) / segLen;

  const x0 = flat[(lo - 1) * 2];
  const y0 = flat[(lo - 1) * 2 + 1];
  out.x = x0 + (flat[lo * 2] - x0) * r;
  out.y = y0 + (flat[lo * 2 + 1] - y0) * r;
  return out;
}

/**
 * Append one arrow's visible body — the slice of its polyline between
 * `tailLen` and `headLen` — to a shared Skia path.
 *
 * This is the whole trick: `moveTo` starts a new disconnected subpath, so N
 * arrows become N subpaths inside ONE Skia.Path object, drawn by ONE <Path>
 * node, instead of N components each with their own derived values.
 */
export function appendBody(path, flat, cumArr, total, angle, tailLen, headLen, scratch) {
  "worklet";
  const start = pointAtLength(flat, cumArr, total, angle, tailLen, scratch);
  path.moveTo(start.x, start.y);

  const n = cumArr.length;
  for (let j = 0; j < n; j++) {
    const c = cumArr[j];
    if (c > tailLen && c < headLen) path.lineTo(flat[j * 2], flat[j * 2 + 1]);
  }

  const end = pointAtLength(flat, cumArr, total, angle, headLen, scratch);
  path.lineTo(end.x, end.y);
}

/**
 * Append one arrowhead triangle, rotated to `angle` and translated to (hx,hy).
 *
 * The old version used <Group transform={[translate, rotate]}> per line, which
 * needs a real component per arrow. Baking the rotation into the vertices lets
 * every arrowhead of a given colour live in a single filled path.
 */
export function appendHead(path, hx, hy, angle) {
  "worklet";
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);

  const x0 = ARROW_TRI[0];
  const y0 = ARROW_TRI[1];
  const x1 = ARROW_TRI[2];
  const y1 = ARROW_TRI[3];
  const x2 = ARROW_TRI[4];
  const y2 = ARROW_TRI[5];

  path.moveTo(hx + x0 * ca - y0 * sa, hy + x0 * sa + y0 * ca);
  path.lineTo(hx + x1 * ca - y1 * sa, hy + x1 * sa + y1 * ca);
  path.lineTo(hx + x2 * ca - y2 * sa, hy + x2 * sa + y2 * ca);
  path.close();
}

/** Canvas coords -> grid cell, for collision lookups. */
export function canvasToCell(x, y, out) {
  "worklet";
  out.row = Math.round((y - GRID_OFFSET_Y) / DOT_SPACING);
  out.col = Math.round((x - GRID_OFFSET_X) / DOT_SPACING);
  return out;
}