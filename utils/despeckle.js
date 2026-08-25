// Despeckle the K-Means label grid before arrows are generated.
//
// WHY
//
// generateLinesData has to put every cell into one of three states: part of an
// arrow of 2+ cells, a 1-cell arrow, or blank. A cell whose four neighbours are
// all OTHER clusters has no same-cluster partner, so it can never join a longer
// arrow - it is a 1-cell arrow or a hole, and there is no third option. See the
// note at the bottom of generateLines.js for why no algorithm can avoid this.
//
// K-Means on a photo produces those lone cells constantly; that is what speckle
// is. Measured on representative boards, 80-91% of all 1-cell arrows came from
// cells that were already isolated in the label grid before generation even
// started.
//
// So the fix belongs HERE, on the labels, not in the generator. Dissolve a lone
// cell into the perceptually nearest cluster touching it and the problem stops
// existing: the cell is now part of a real region and can join a real arrow.
//
// THE COST is a small colour error, and it is paid exactly where the eye is
// least able to notice - an isolated pixel surrounded by other colours reads as
// noise, not as detail. Nearest is measured in CIELAB (colorSpace.js), so the
// replacement is the closest colour a person would actually perceive, not the
// closest set of RGB numbers.
//
// WHAT THIS DOES ACHIEVE: afterwards the label grid contains NO lone cells at
// all - measured zero on every board tested, converging in two passes.
//
// WHAT IT CANNOT DO: the board still ends up with some 1-cell arrows, and after
// this pass every single one of them comes from the GENERATOR, not the labels.
// randomWalkBody consumes cells as it goes and can strand one behind it, and a
// large region with spurs hanging off it cannot be fully covered by paths of 2+
// anyway. That residual is 5-13% of arrows. It is not speckle and cannot be
// recoloured away; closing it further means a smarter body walk (a
// matching-based path cover rather than Warnsdorff), which would cost no colour
// fidelity at all.

import { rgbToLab } from "./colorSpace";

const NEIGHBOURS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * @param {number[][]} labelGrid - cluster index per cell, -1 = background.
 * @param {{r:number,g:number,b:number}[]} palette - the K cluster colours.
 * @param {{minRegionSize?:number, maxPasses?:number}} [options]
 *   minRegionSize - dissolve any same-cluster region SMALLER than this. 2 means
 *     lone cells only, which is the case that is provably unfixable later and
 *     the one that dominates. 3 and 4 also take pairs and triples, which are
 *     legal arrows in themselves, so raising it trades picture fidelity for
 *     fewer trivial taps rather than fixing anything structural. 0 or 1
 *     disables the pass entirely.
 *   maxPasses - dissolving a region can leave its neighbour small in turn, so
 *     the pass repeats until nothing changes or this many passes have run.
 * @returns {{labelGrid:number[][], merged:number, cellsChanged:number, passes:number}}
 *   `labelGrid` is a NEW grid; the input is never mutated.
 */
export function despeckleLabels(labelGrid, palette, options = {}) {
  const { minRegionSize = 2, maxPasses = 4 } = options;

  const rows = labelGrid.length;
  const cols = rows > 0 ? labelGrid[0].length : 0;
  let grid = labelGrid.map((row) => row.slice());

  if (minRegionSize < 2 || rows === 0 || cols === 0) {
    return { labelGrid: grid, merged: 0, cellsChanged: 0, passes: 0 };
  }

  // Palette in CIELAB once, so the inner loop is plain arithmetic.
  const lab = palette.map((p) => rgbToLab(p.r, p.g, p.b));
  const labDist = (a, b) => {
    if (!lab[a] || !lab[b]) return Infinity;
    const dL = lab[a].L - lab[b].L;
    const da = lab[a].a - lab[b].a;
    const db = lab[a].b - lab[b].b;
    return dL * dL + da * da + db * db;
  };

  let merged = 0;
  let cellsChanged = 0;
  let passes = 0;

  const cellCount = rows * cols;
  // Marks cells already accounted for this pass, so a merged region is not
  // reconsidered as a fresh candidate.
  const processed = new Uint8Array(cellCount);
  // Visited marker for one flood, stamped with a generation counter so it
  // never has to be cleared.
  const stamp = new Int32Array(cellCount);
  let generation = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    passes = pass + 1;
    processed.fill(0);
    let mergedThisPass = 0;

    for (let r0 = 0; r0 < rows; r0++) {
      for (let c0 = 0; c0 < cols; c0++) {
        const start = r0 * cols + c0;
        if (processed[start]) continue;

        const label = grid[r0][c0];
        if (label === -1) continue;

        // Flood the 4-connected same-label region, collecting the labels
        // bordering it as we go.
        //
        // MERGES APPLY IMMEDIATELY, against the live grid, rather than being
        // batched against a snapshot of the pass. Batching looks tidier and is
        // wrong: two adjacent lone cells of different clusters each pick the
        // other's label as nearest, so they SWAP and both stay lone. The pass
        // then never converges - it just recolours more of the board every
        // pass for no reduction at all. Applying in place means the first is
        // already merged when the second is examined, so they join instead.
        generation += 1;
        stamp[start] = generation;
        const cells = [start];
        const stack = [start];
        const border = new Map();

        // Bounded by minRegionSize: the moment the region is that big it
        // cannot be speckle, and nothing beyond that is needed. This is what
        // keeps a 5000-cell background region from being walked end to end
        // every time one of its cells comes up.
        while (stack.length > 0 && cells.length < minRegionSize) {
          const idx = stack.pop();
          const r = (idx / cols) | 0;
          const c = idx - r * cols;

          for (let n = 0; n < NEIGHBOURS.length; n++) {
            const nr = r + NEIGHBOURS[n][0];
            const nc = c + NEIGHBOURS[n][1];
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

            const nl = grid[nr][nc];
            if (nl === label) {
              const ni = nr * cols + nc;
              if (stamp[ni] !== generation) {
                stamp[ni] = generation;
                cells.push(ni);
                stack.push(ni);
              }
            } else if (nl !== -1) {
              border.set(nl, (border.get(nl) ?? 0) + 1);
            }
          }
        }

        for (let i = 0; i < cells.length; i++) processed[cells[i]] = 1;

        // Reached the size cap, so the region is big enough to keep. Note the
        // flood was cut short, so `border` is incomplete - which is fine,
        // because it is only consulted for regions that are dissolved.
        if (cells.length >= minRegionSize) continue;

        // Nothing but background around it - there is no cluster to dissolve
        // into, so it stays exactly as it is.
        if (border.size === 0) continue;

        // Perceptually nearest bordering cluster. Ties break on the longer
        // shared border, then on the lower index, so the result is
        // deterministic and does not depend on Map iteration order.
        let bestLabel = -1;
        let bestDist = Infinity;
        let bestShare = -1;
        for (const [candidate, share] of border) {
          const d = labDist(label, candidate);
          if (
            d < bestDist ||
            (d === bestDist &&
              (share > bestShare ||
                (share === bestShare && candidate < bestLabel)))
          ) {
            bestLabel = candidate;
            bestDist = d;
            bestShare = share;
          }
        }
        if (bestLabel === -1) continue;

        for (let i = 0; i < cells.length; i++) {
          const idx = cells[i];
          const r = (idx / cols) | 0;
          grid[r][idx - r * cols] = bestLabel;
        }
        merged += 1;
        mergedThisPass += 1;
        cellsChanged += cells.length;
      }
    }

    if (mergedThisPass === 0) break;
  }

  return { labelGrid: grid, merged, cellsChanged, passes };
}

/**
 * Re-snap a quantized colour grid to a label grid that has since been
 * despeckled, so the dot picture and the arrows never disagree about what
 * colour a cell is.
 *
 * kMeansQuantizeColors writes "rgba(r,g,b,a)" with the alpha of the SOURCE
 * pixel, which is what keeps a cut-out photo's soft edges. That alpha is
 * preserved here: only the colour is replaced, and only for cells whose label
 * actually moved.
 *
 * @returns {string[][]} a NEW grid; the input is never mutated.
 */
export function recolorFromLabels(colorGrid, labelGrid, palette) {
  const rows = colorGrid.length;
  const out = new Array(rows);

  for (let r = 0; r < rows; r++) {
    const src = colorGrid[r];
    const labels = labelGrid[r];
    const row = src.slice();

    for (let c = 0; c < row.length; c++) {
      const label = labels[c];
      if (label === -1) continue; // background keeps its original string
      const p = palette[label];
      if (!p) continue;

      // Reuse the existing alpha rather than re-deriving it. A cell that is
      // already the right colour is left byte-identical, which keeps this a
      // no-op when despeckling is disabled.
      const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(src[c])?.[1];
      const next =
        alpha === undefined
          ? `rgb(${p.r},${p.g},${p.b})`
          : `rgba(${p.r},${p.g},${p.b},${alpha})`;
      if (next !== src[c]) row[c] = next;
    }
    out[r] = row;
  }
  return out;
}
