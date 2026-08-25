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
// WHAT THIS CANNOT DO: large regions can also strand cells, because a region
// with spurs hanging off it has no way to cover every cell with paths of 2+
// either. Those are structural and are not speckle, so they are left alone -
// they are the residual 9-20% and merging them would mean repainting real parts
// of the picture.

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

  for (let pass = 0; pass < maxPasses; pass++) {
    passes = pass + 1;

    // Snapshot the pass so every decision in it reads the same grid. Chains of
    // adjacent speckle resolve over successive passes instead of depending on
    // scan order within one.
    const snapshot = grid;
    const next = snapshot.map((row) => row.slice());
    const seen = new Uint8Array(rows * cols);
    let mergedThisPass = 0;

    for (let r0 = 0; r0 < rows; r0++) {
      for (let c0 = 0; c0 < cols; c0++) {
        if (seen[r0 * cols + c0]) continue;
        const label = snapshot[r0][c0];
        if (label === -1) continue;

        // Flood the 4-connected same-label region, collecting the labels that
        // border it as we go. Stops early once the region is provably big
        // enough to keep - most of the board is one of these, and walking a
        // 5000-cell background region to learn it is not speckle is the only
        // thing here that would ever cost anything.
        const cells = [];
        const stack = [r0 * cols + c0];
        seen[r0 * cols + c0] = 1;
        const border = new Map();
        let tooBig = false;

        while (stack.length > 0) {
          const idx = stack.pop();
          const r = (idx / cols) | 0;
          const c = idx - r * cols;
          cells.push(idx);

          if (cells.length >= minRegionSize) tooBig = true;

          for (let n = 0; n < NEIGHBOURS.length; n++) {
            const nr = r + NEIGHBOURS[n][0];
            const nc = c + NEIGHBOURS[n][1];
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

            const nl = snapshot[nr][nc];
            if (nl === label) {
              const ni = nr * cols + nc;
              if (!seen[ni]) {
                seen[ni] = 1;
                stack.push(ni);
              }
            } else if (nl !== -1) {
              border.set(nl, (border.get(nl) ?? 0) + 1);
            }
          }
        }

        if (tooBig) continue;

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
          next[r][idx - r * cols] = bestLabel;
        }
        merged += 1;
        mergedThisPass += 1;
        cellsChanged += cells.length;
      }
    }

    grid = next;
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
