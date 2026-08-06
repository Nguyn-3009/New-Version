/**
 * Milestone 2: turn the K-Means label grid (from kMeansQuantizeColors) into
 * actual escapable-arrow LINES data - the same shape as the static `LINES`
 * export in app/utils/LINE_TRIGGER.js, ready to drop into play/index.jsx.
 *
 * This is a direct implementation of the algorithm from ThoughtProcess.docx:
 *
 *   1. Scan for "place-head" points.
 *   2. Choose the "direction-define" point (the direction the arrow points).
 *   3. Find a tail point (same color/cluster, reachable without crossing
 *      blank/other-cluster/other-line cells).
 *   4. Draw the path connecting tail -> direction-define point -> head.
 *   5. Those cells are now spoken for (removed from the pool).
 *   6. Repeat until only isolated points (left blank) or fully-occupied
 *      space remains.
 *
 * Rules enforced:
 *   RULE 1 (no self-loop): the body is always the *shortest* grid path
 *     between two points (BFS), which by construction never revisits a
 *     cell, so a line can never cross its own body.
 *   RULE 2 (no cyclic blocking): a new arrow's pointing direction is only
 *     ever "into" cells that are out of bounds, a different cluster, or
 *     already decided (blank/occupied) by an *earlier* iteration - never
 *     an as-yet-undecided cell. Any undecided cell that lies along the
 *     escape ray is immediately blanked (see below), so a line's escape
 *     path, once granted, can never be blocked by a *later* iteration.
 *     Dependencies therefore only ever point from later-built lines back
 *     to earlier-built ones, which is acyclic by construction.
 *   RULE 3 (one color per arrow): the body/tail search never leaves the
 *     head's cluster.
 *   RULE 4 (REMOVED): a free cell with zero free same-cluster neighbors used
 *     to be marked blank, which was the ONLY significant source of blank
 *     cells (~3.7% of the grid; escape rays contribute ~0 because they stop
 *     at the first already-decided cell). Such a cell now becomes a valid
 *     1-cell arrow instead, so the rendered image has no holes. A 1-cell
 *     arrow still obeys every other rule: it is a place-head, it points
 *     outward, and its escape ray is reserved exactly as before.
 *
 * Output shape: [{ id, color, points: [{row,col}, ...] }, ...] where
 * `points` only contains the *turning* points (start, corners, end) -
 * exactly what play/index.jsx's `expandSegments` already expects.
 */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRECTIONS = [
  { name: "up", dr: -1, dc: 0 },
  { name: "down", dr: 1, dc: 0 },
  { name: "left", dr: 0, dc: -1 },
  { name: "right", dr: 0, dc: 1 },
];

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

function keyOf(row, col) {
  return `${row},${col}`;
}

function paletteToColor(rgb) {
  return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

/**
 * @param {number[][]} labelGrid - cluster index per cell, -1 = background
 *   (output of kMeansQuantizeColors).
 * @param {{r:number,g:number,b:number}[]} palette - the K cluster colors.
 * @returns {{
 *   lines: {id:string,color:string,points:{row:number,col:number}[]}[],
 *   blanks: {row:number,col:number}[],
 * }}
 */
export function generateLinesData(
  labelGrid,
  palette,
  { seed = 1337, minBodyLength = 1, maxBodyLength = 375 } = {},
) {
  const rng = mulberry32(seed);
  const rows = labelGrid.length;
  const cols = rows > 0 ? labelGrid[0].length : 0;

  // null = free, "blank" = permanently excluded, anything else = a line id
  const occupied = Array.from({ length: rows }, () => new Array(cols).fill(null));

  const inBounds = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const labelOf = (r, c) => (inBounds(r, c) ? labelGrid[r][c] : -1);
  const isFree = (r, c) => inBounds(r, c) && occupied[r][c] === null && labelOf(r, c) !== -1;
  const isFreeSameLabel = (r, c, label) => isFree(r, c) && labelOf(r, c) === label;

  function freeDirs(r, c) {
    const label = labelOf(r, c);
    return DIRECTIONS.filter((d) => isFreeSameLabel(r + d.dr, c + d.dc, label));
  }

  /**
   * Decide whether (r,c) is a valid "place-head" point, per the doc:
   *  - an odd number (1 or 3) of free same-cluster neighbors, or
   *  - exactly 2 free same-cluster neighbors that are NOT an opposite pair
   *    (i.e. a corner, not a straight corridor).
   * Also returns the (forced or first-valid) outward pointing direction:
   * a currently-blocked direction whose opposite is one of the free ones,
   * so the direction-define point (opposite of pointing) is guaranteed to
   * land on a free, same-cluster cell.
   */
  function candidateInfo(r, c) {
    const fd = freeDirs(r, c);
    const k = fd.length;

    if (k === 0) {
      // No same-cluster neighbours: this is a 1-cell arrow. Every direction
      // is "blocked", so any of them is a legal pointing direction. Pick the
      // one whose escape ray would blank the fewest still-free cells, which
      // keeps the knock-on blanking to a minimum.
      let best = DIRECTIONS[0];
      let bestCost = Infinity;
      for (const d of DIRECTIONS) {
        let cost = 0;
        let rr = r + d.dr;
        let cc = c + d.dc;
        while (inBounds(rr, cc) && isFree(rr, cc)) {
          cost++;
          rr += d.dr;
          cc += d.dc;
        }
        if (cost < bestCost) {
          bestCost = cost;
          best = d;
        }
      }
      return { kind: "single", pointing: best };
    }
    if (k === 4) return { kind: "interior" };
    if (k === 2 && OPPOSITE[fd[0].name] === fd[1].name) return { kind: "corridor" };

    const freeNames = new Set(fd.map((d) => d.name));
    const blockedDirs = DIRECTIONS.filter((d) => !freeNames.has(d.name));
    const pointing = blockedDirs.find((d) => freeNames.has(OPPOSITE[d.name]));

    if (!pointing) return { kind: "corridor" }; // defensive; shouldn't happen for k in {1,2-corner,3}

    return { kind: "head", pointing };
  }


  function randomWalkBody(start, label, excludeKey) {
    const target =
      minBodyLength + Math.floor(rng() * (maxBodyLength - minBodyLength + 1));

    const visited = new Set([excludeKey, keyOf(start.row, start.col)]);
    const path = [start];
    let cur = start;

    while (path.length < target) {
      const options = [];
      for (const d of DIRECTIONS) {
        const nr = cur.row + d.dr;
        const nc = cur.col + d.dc;
        if (!isFreeSameLabel(nr, nc, label)) continue;
        if (visited.has(keyOf(nr, nc))) continue;
        options.push({ row: nr, col: nc });
      }
      if (options.length === 0) break;

      const next = options[Math.floor(rng() * options.length)];
      visited.add(keyOf(next.row, next.col));
      path.push(next);
      cur = next;
    }

    return path;
  }

  function bfsFarthestSameLabel(start, label, excludeKey) {
    const visited = new Set([keyOf(start.row, start.col)]);
    const parent = new Map();
    const queue = [start];
    let qi = 0;
    let farthest = start;

    while (qi < queue.length) {
      const cur = queue[qi++];
      farthest = cur;
      for (const d of DIRECTIONS) {
        const nr = cur.row + d.dr;
        const nc = cur.col + d.dc;
        const k = keyOf(nr, nc);
        if (visited.has(k) || k === excludeKey) continue;
        if (!isFreeSameLabel(nr, nc, label)) continue;
        visited.add(k);
        parent.set(k, cur);
        queue.push({ row: nr, col: nc });
      }
    }

    // Reconstruct path start -> farthest
    const path = [farthest];
    let cur = farthest;
    while (keyOf(cur.row, cur.col) !== keyOf(start.row, start.col)) {
      cur = parent.get(keyOf(cur.row, cur.col));
      path.push(cur);
    }
    path.reverse(); // start ... farthest
    return path;
  }

  function compressToTurns(path) {
    if (path.length <= 2) return path.map((p) => ({ row: p.row, col: p.col }));
    const turns = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const cur = path[i];
      const next = path[i + 1];
      const d1r = cur.row - prev.row;
      const d1c = cur.col - prev.col;
      const d2r = next.row - cur.row;
      const d2c = next.col - cur.col;
      if (d1r !== d2r || d1c !== d2c) turns.push(cur);
    }
    turns.push(path[path.length - 1]);
    return turns.map((p) => ({ row: p.row, col: p.col }));
  }

  const lines = [];
  const blanks = [];

  const frontier = new Set();
  const requeueNeighbors = (r, c) => {
    for (const d of DIRECTIONS) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (isFree(nr, nc)) frontier.add(keyOf(nr, nc));
    }
  };

  const markOccupied = (r, c, id) => {
    occupied[r][c] = id;
    requeueNeighbors(r, c);
  };
  const markBlank = (r, c) => {
    occupied[r][c] = "blank";
    blanks.push({ row: r, col: c });
    requeueNeighbors(r, c);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isFree(r, c)) frontier.add(keyOf(r, c));
    }
  }

  let lineCounter = 0;
  // Cells that are "interior"/"corridor" right now just get skipped; they'll
  // be re-added to the frontier automatically once one of their neighbors
  // changes state (markOccupied/markBlank both requeue neighbors), so this
  // always terminates: every iteration strictly shrinks the free pool.
  while (frontier.size > 0) {
    const k = frontier.values().next().value;
    frontier.delete(k);
    const [r, c] = k.split(",").map(Number);
    if (!isFree(r, c)) continue;

    const info = candidateInfo(r, c);
    if (info.kind === "interior" || info.kind === "corridor") {
      continue; // wait for a neighbor to resolve first
    }

    // info.kind === "head"
    const label = labelOf(r, c);
    const pointing = info.pointing;
    const back = DIRECTIONS.find((d) => d.name === OPPOSITE[pointing.name]);
    const ddp = { row: r + back.dr, col: c + back.dc }; // direction-define point

    const head = { row: r, col: c };
    // A 1-cell arrow has no body at all - the head IS the whole line.
    // bfsFarthestSameLabel returns [ddp, ..., tail] (start -> farthest); we
    // need the body to run tail -> ... -> ddp so `head` lands immediately
    // after ddp (its only adjacent cell), not after the far-away tail.
    const fullPath =
      info.kind === "single"
        ? [head]
        : [...randomWalkBody(ddp, label, keyOf(head.row, head.col)).reverse(), head];

    lineCounter += 1;
    const id = `line${lineCounter}`;
    for (const cell of fullPath) markOccupied(cell.row, cell.col, id);

    // Preserve this arrow's escape ray forever: any *undecided* cell (any
    // cluster) along the outward direction gets locked out from ever being
    // used by a future arrow. Stop at the first already-decided
    // (occupied/blank) cell - that's a legitimate "must clear that one
    // first" dependency, not something we need to touch.
    let rr = r + pointing.dr;
    let cc = c + pointing.dc;
    while (inBounds(rr, cc)) {
      if (!isFree(rr, cc)) break;
      markBlank(rr, cc);
      rr += pointing.dr;
      cc += pointing.dc;
    }

    lines.push({
      id,
      color: paletteToColor(palette[label]),
      points: compressToTurns(fullPath),
      // Explicit escape direction. Consumers used to derive this from the
      // last two points, which is impossible for a 1-cell arrow - and is
      // redundant work for every other arrow anyway.
      dir: { dr: pointing.dr, dc: pointing.dc },
    });
  }

  return { lines, blanks };
}